-- ==============================================================================
-- PING — FASE L2: BACKEND SUPABASE & LOBBY EM TEMPO REAL
-- ==============================================================================
-- Migration SQL para catálogo de salas, sincronização Realtime e segurança RLS.
-- Execute este arquivo no SQL Editor do seu projeto Supabase.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL (PRIVADA / RESTRITA)
-- ------------------------------------------------------------------------------
-- Contém metadados de sessão, segredos de senha (salt e hash) e token do anfitrião.
-- O acesso direto a esta tabela por clientes anon é totalmente bloqueado via RLS.
CREATE TABLE IF NOT EXISTS public.rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false,
  pw_salt TEXT,
  pw_hash TEXT,
  viewers INT NOT NULL DEFAULT 0 CHECK (viewers >= 0),
  capacity INT NOT NULL DEFAULT 5,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  host_token TEXT NOT NULL
);

-- Índices para consultas de listagem e limpeza periódica
CREATE INDEX IF NOT EXISTS idx_rooms_active ON public.rooms (is_private, last_seen);
CREATE INDEX IF NOT EXISTS idx_rooms_cleanup ON public.rooms (last_seen);

-- Habilita RLS (nenhuma política direta = acesso negado por padrão para anon)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. TABELA ESPELHO PÚBLICA (READ-ONLY PARA O LOBBY / REALTIME)
-- ------------------------------------------------------------------------------
-- Nunca armazena pw_salt, pw_hash ou host_token.
-- É transmitida pelo Supabase Realtime aos navegadores conectados ao Lobby.
CREATE TABLE IF NOT EXISTS public.rooms_public (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false,
  viewers INT NOT NULL DEFAULT 0,
  capacity INT NOT NULL DEFAULT 5,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_public_active ON public.rooms_public (last_seen);

ALTER TABLE public.rooms_public ENABLE ROW LEVEL SECURITY;

-- Política de leitura pública irrestrita na tabela espelho
DROP POLICY IF EXISTS "Permitir leitura publica de salas" ON public.rooms_public;
CREATE POLICY "Permitir leitura publica de salas"
  ON public.rooms_public
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ------------------------------------------------------------------------------
-- 3. TRIGGER DE SINCRONIZAÇÃO ENTRE ROOMS E ROOMS_PUBLIC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_rooms_to_public()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.rooms_public (id, name, host, is_private, viewers, capacity, last_seen, created_at)
    VALUES (NEW.id, NEW.name, NEW.host, NEW.is_private, NEW.viewers, NEW.capacity, NEW.last_seen, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      host = EXCLUDED.host,
      is_private = EXCLUDED.is_private,
      viewers = EXCLUDED.viewers,
      capacity = EXCLUDED.capacity,
      last_seen = EXCLUDED.last_seen;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.rooms_public SET
      name = NEW.name,
      host = NEW.host,
      is_private = NEW.is_private,
      viewers = NEW.viewers,
      capacity = NEW.capacity,
      last_seen = NEW.last_seen
    WHERE id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.rooms_public WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_rooms_to_public ON public.rooms;
CREATE TRIGGER trg_sync_rooms_to_public
  AFTER INSERT OR UPDATE OR DELETE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_rooms_to_public();

-- ------------------------------------------------------------------------------
-- 4. HABILITAÇÃO DO SUPABASE REALTIME NA TABELA ESPELHO
-- ------------------------------------------------------------------------------
-- Garante que o Postgres publique alterações para os canais de websocket do Supabase
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms_public'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms_public;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. FUNÇÕES ARMAZENADAS (RPCs COM SECURITY DEFINER)
-- ------------------------------------------------------------------------------

-- (a) Criação de sala com checagem estrita de limite de 5 salas abertas
CREATE OR REPLACE FUNCTION public.create_room(
  p_name TEXT,
  p_host TEXT,
  p_is_private BOOLEAN,
  p_pw_salt TEXT DEFAULT NULL,
  p_pw_hash TEXT DEFAULT NULL,
  p_host_token TEXT DEFAULT NULL,
  p_room_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_count INT;
  v_room_id TEXT;
  v_token TEXT;
  v_created TIMESTAMPTZ := now();
BEGIN
  -- Limpeza preguiçosa: remove salas sem heartbeat há mais de 60 segundos
  DELETE FROM public.rooms WHERE last_seen < now() - interval '60 seconds';

  -- Validação de entrada
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'NOME_OBRIGATORIO';
  END IF;

  -- Se a sala for aberta, aplica a trava de 5 salas simultâneas ativas
  IF NOT p_is_private THEN
    SELECT count(*) INTO v_open_count
    FROM public.rooms
    WHERE is_private = false AND last_seen >= now() - interval '60 seconds';

    IF v_open_count >= 5 THEN
      RAISE EXCEPTION 'LIMITE_SALAS_ABERTAS';
    END IF;
  ELSE
    IF p_pw_hash IS NULL OR p_pw_salt IS NULL THEN
      RAISE EXCEPTION 'SENHA_OBRIGATORIA_PARA_SALA_FECHADA';
    END IF;
  END IF;

  -- Identificador da sala com prefixo ping-
  IF p_room_id IS NOT NULL AND length(p_room_id) >= 6 THEN
    v_room_id := p_room_id;
  ELSE
    v_room_id := 'ping-' || lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
  END IF;

  -- Token de autorização exclusiva do anfitrião
  IF p_host_token IS NOT NULL AND length(p_host_token) >= 8 THEN
    v_token := p_host_token;
  ELSE
    v_token := encode(gen_random_bytes(16), 'hex');
  END IF;

  INSERT INTO public.rooms (
    id, name, host, is_private, pw_salt, pw_hash, viewers, capacity, last_seen, created_at, host_token
  ) VALUES (
    v_room_id, trim(p_name), trim(p_host), p_is_private, p_pw_salt, p_pw_hash, 0, 5, v_created, v_created, v_token
  );

  RETURN jsonb_build_object(
    'id', v_room_id,
    'name', trim(p_name),
    'host', trim(p_host),
    'isPrivate', p_is_private,
    'viewers', 0,
    'capacity', 5,
    'hostToken', v_token
  );
END;
$$;

-- (b) Heartbeat da sala a cada 20 segundos (somente anfitrião com token)
CREATE OR REPLACE FUNCTION public.heartbeat_room(
  p_room_id TEXT,
  p_host_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.rooms
  SET last_seen = now()
  WHERE id = p_room_id AND host_token = p_host_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- (c) Atualização de espectadores conectados (somente anfitrião com token)
CREATE OR REPLACE FUNCTION public.update_viewers(
  p_room_id TEXT,
  p_host_token TEXT,
  p_viewers INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.rooms
  SET viewers = greatest(0, p_viewers),
      last_seen = now()
  WHERE id = p_room_id AND host_token = p_host_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- (d) Encerramento explícito de sala
CREATE OR REPLACE FUNCTION public.close_room(
  p_room_id TEXT,
  p_host_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.rooms
  WHERE id = p_room_id AND host_token = p_host_token;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

-- (e) Obtenção do salt de senha para derivação no cliente (nunca expõe pw_hash)
CREATE OR REPLACE FUNCTION public.get_room_salt(p_room_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salt TEXT;
BEGIN
  SELECT pw_salt INTO v_salt
  FROM public.rooms
  WHERE id = p_room_id;

  RETURN v_salt;
END;
$$;

-- (f) Validação de hash no servidor (para clientes ou anfitrião)
CREATE OR REPLACE FUNCTION public.verify_room_password(
  p_room_id TEXT,
  p_pw_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_hash TEXT;
BEGIN
  SELECT pw_hash INTO v_stored_hash
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_stored_hash IS NULL OR p_pw_hash IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_stored_hash = p_pw_hash;
END;
$$;

-- Concede permissão de execução nas RPCs para o perfil anon e authenticated
GRANT EXECUTE ON FUNCTION public.create_room TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_room TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_viewers TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_room TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_salt TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_room_password TO anon, authenticated;
