# Ping — Decisões de Design e Arquitetura de UI

Este documento registra as decisões técnicas, escolhas de design, tokens e adequações de acessibilidade adotadas na implementação da interface do **Ping** a partir dos designs do Figma (`MNxrW5u2UPqTi8Fvw6dGuG`) e especificações da fase Lobby.

---

## 1. Visão Geral e Arquitetura

O Ping foi expandido de uma página direta de transmissão P2P para uma plataforma completa com **Lobby em 3 colunas**, mantendo **100% intacta** a transmissão de mídia WebRTC ponta a ponta existente.

### Camadas da Aplicação
- **`src/styles/tokens.css`**: Sistema de tokens semânticos (cores, espaçamentos, tipografia, bordas, sombras e transições) suportando 2 modos (*Light* e *Dark*) e 3 paletas de marca (*Indigo*, *Teal* e *Terracota*).
- **`src/theme.ts` & `public/theme-init.js`**: Mecanismo de persistência e aplicação de tema/paleta com execução síncrona antes do primeiro paint, garantindo **zero FOUC** (Flash of Unstyled Content).
- **`src/app/dom.ts`**: Construtor tipado de elementos DOM (`h()`), renderizador de ícones SVG seguros inline (`icon()`), normalização de busca (`normalize()`) e utilitários de debounce.
- **`src/app/primitives.ts`**: Componentes atômicos reutilizáveis (`Button`, `Avatar`, `Badge`, `Skeleton`, `Field`, `openDialog`).
- **`src/app/services/rooms.ts`**: Contrato `RoomService` e implementação `MockRoomService` com suporte a limites globais de capacidade e bloqueio de tentativas de senha.
- **`src/app/identity.ts`**: Gerador de identidade anônima no formato `user{8 dígitos}` via `crypto.getRandomValues`, com persistência em `localStorage`.
- **`src/app/components.ts`**: Componentes de alto nível (`SidebarNav`, `BottomNav`, `RoomCard`, `SearchInput`, `AdSlot`, `Banner`, `EmptyState`).
- **`src/app/modals.ts`**: Modais com trapping de foco, validação e acessibilidade (`openCreateRoomModal`, `openPasswordModal`, `openProfileModal`).
- **`src/app/app.ts`**: Orquestrador da interface do Lobby e chaveamento para o modo anfitrião.
- **`src/host.ts` & `src/viewer.ts`**: Módulos legados de transmissão P2P, encapsulados com isolamento de estilos.

---

## 2. Layout em 3 Colunas e Responsividade

O layout é composto por uma grid CSS fluida que se adapta aos seguintes breakpoints:

| Breakpoint | Resolução Base | Sidebar Esquerda | Feed Central | Sidebar Direita (Ads) |
|---|---|---|---|---|
| **Desktop** | ≥ 1100px (1440×900) | 260px fixa (navegação + perfil) | `minmax(0, 1fr)` centralizado (máx 720px) | 320px fixa (slots `300×250` e `300×600`) |
| **Tablet** | 768px – 1099px | 72px (mini-dock com ícones) | Fluido | Oculta na direita; slot horizontal `320×100` exibido abaixo do feed |
| **Mobile** | < 768px (375×812) | Oculta (substituída por `BottomNav` fixa com safe-area) | 100% largura | Oculta na lateral; anúncios nativos intercalados no feed a cada 4 cards |

---

## 3. Paletas de Cor e Ajustes de Contraste WCAG AA

Todas as cores foram verificadas através de um validador de luminância relativa (`scripts/contrast.mjs`), garantindo:
- **Texto normal**: contraste mínimo de **4.5:1** contra o fundo e contra os cartões.
- **Componentes de UI / botões**: contraste mínimo de **3.0:1** contra superfícies adjacentes.

### Ajustes Finos Realizados nos Tokens Originais:
1. **Indigo Escuro**:
   - `--text-3` ajustado de `#71717a` (3.9:1) para `#818189` (**4.59:1** no card e **5.15:1** no fundo).
   - `--primary` no escuro ajustado de `#6366f1` (3.8:1) para `#6164ec` (**4.62:1** para o texto do botão).
2. **Teal Claro**:
   - `--text-3` ajustado de `#64748b` (4.4:1) para `#627288` (**4.90:1**).
3. **Teal Escuro**:
   - `--text-3` ajustado de `#64748b` (3.6:1) para `#768498` (**4.62:1**).
4. **Terracota Claro**:
   - `--text-3` ajustado de `#78716c` (4.3:1) para `#7d6f65` (**4.77:1**).
5. **Terracota Escuro**:
   - `--text-3` ajustado de `#78716c` (3.3:1) para `#938579` (**4.61:1**).

O script `node scripts/contrast.mjs` valida programaticamente as 6 combinações (3 paletas × 2 temas), emitindo `0 falhas`.

---

## 4. Identidade Anônima e Conector Discord

- **Geração**: Ao abrir o Ping pela primeira vez, se a chave `ping:identity` não existir no `localStorage`, uma identidade única é gerada via `crypto.getRandomValues(new Uint32Array(1))[0] % 90000000 + 10000000`, produzindo identificadores entre `user10000000` e `user99999999`.
- **Badge Anônimo**: A identidade exibe o selo "Anônimo".
- **Integração Discord**: O modal de perfil contém a ação "Conectar com Discord" estilizada com a identidade visual da marca Discord (`#5865F2`). Enquanto a conta não for vinculada, a edição de apelido e nome completo permanece desabilitada com dicas contextuais.

---

## 5. Regras de Negócio do Catálogo de Salas

- **Capacidade por Sala**: Cada sala possui capacidade máxima de 5 espectadores simultâneos.
- **Salas Lotadas**: Salas com `viewers >= capacity` recebem a badge "Lotada", atributo `aria-disabled="true"` e classe visual `.is-full`, permanecendo focáveis por teclado para leitura por tecnologias assistivas, mas sem disparar conexão ao clique.
- **Limite Global de 5 Salas Abertas**: O serviço `MockRoomService` e o modal de criação fiscalizam a regra de negócio que restringe a plataforma a no máximo 5 salas abertas ativas simultaneamente:
  - O cabeçalho exibe um chip de status com a contagem (`n / 5`).
  - Ao atingir 5 salas abertas, o modal de criação exibe um banner de aviso bloqueando a criação de novas salas abertas, permitindo apenas a criação de salas protegidas por senha.
- **Bloqueio de Senha**:
  - Salas fechadas contam tentativas incorretas (`0 / 3`).
  - Na 3ª tentativa com erro, o serviço impõe um lockout temporário de 30 segundos com contagem regressiva em tempo real.
  - O formulário executa animação de feedback `shake` em senhas incorretas.

---

## 6. Acessibilidade (A11y) e Navegação por Teclado

- **Atalho `/`**: Pressionar a barra `/` em qualquer lugar fora de inputs direciona o foco imediatamente para a caixa de busca.
- **Atalho `Esc`**: Limpa o texto da busca e restaura o foco, ou fecha o modal aberto devolvendo o foco ao elemento acionador original.
- **Alternador de Senha**: Botões com ícone de olho possuem rótulos descritivos dinâmicos ("Mostrar senha" / "Ocultar senha") e refletem o estado no atributo `aria-pressed`.
- **Modais Nativos**: Utilizam o elemento `<dialog>` com `.showModal()`, garantindo trapping de foco, fechamento automático com `Escape` e bloqueio de rolagem do body.
- **Preferência de Movimento**: Suporte nativo a `@media (prefers-reduced-motion: reduce)`, desativando transições bruscas, shimmers e animações de shake.

---

## 7. Conformidade com Content Security Policy (CSP)

A política de segurança restritiva definida no `vercel.json` (`script-src 'self'`, `style-src 'self'`) proíbe qualquer estilo inline (`style="..."`) e scripts inline.
- **Fontes**: Em vez do Google Fonts externo, foi instalado o pacote self-hosted `@fontsource-variable/inter`, com os arquivos woff2 embutidos no bundle local da aplicação.
- **Inicialização de Tema**: O script `public/theme-init.js` é servido como arquivo estático externo carregado no `<head>`, executando de forma síncrona sem violar o CSP.
- **Estilos Globais**: Carregados via tag `<link rel="stylesheet" href="/src/styles/index.css" />`.

---

## 8. Compatibilidade com Modos Legados de Transmissão

- **Roteamento de URLs**:
  - `/`: Lobby completo com catálogo de salas, perfil e anúncios.
  - `/?host=1`: Modo anfitrião direto (para testes e atalhos rápidos).
  - `/?room=<id>`: Modo espectador direto WebRTC.
- **Integração do Modal Criar Sala**: Criar uma sala no Lobby transiciona diretamente para o painel do anfitrião com o campo de senha pré-preenchido e o link de compartilhamento pronto para ser enviado.

---

## 9. Backend Supabase e Sincronização em Tempo Real (Fase L2)

- **Tabela Espelho `rooms_public` & Limitação do Realtime**: O Supabase Realtime via Postgres CDC não oferece filtragem refinada de colunas em views. Para impedir o vazamento de hashes de senha (`pw_hash`), sais (`pw_salt`) e tokens do anfitrião (`host_token`), foi criada uma tabela espelho `rooms_public` sincronizada automaticamente por trigger na tabela base `rooms`. A tabela pública é adicionada à publicação `supabase_realtime` com permissão de leitura para `anon`, enquanto a tabela base permanece 100% inacessível diretamente por RLS.
- **RPCs com `SECURITY DEFINER`**: Todas as mutações e validações sensíveis rodam no banco:
  - `create_room`: aplica lazy cleanup de salas sem heartbeat há mais de 60 segundos e restringe a criação a no máximo 5 salas abertas ativas (erro `LIMITE_SALAS_ABERTAS`).
  - `heartbeat_room` & `update_viewers`: exigem o token secreto gerado exclusivamente para o anfitrião no momento da criação.
  - `get_room_salt`: retorna apenas o sal criptográfico para que o cliente derive o PBKDF2.
  - `verify_room_password`: valida o hash sem nunca expor o hash original guardado no banco.
- **Ciclo de Vida do Anfitrião**:
  - Heartbeat periódico a cada 20 segundos via `heartbeat_room`.
  - Atualização do contador de espectadores sincronizada com throttle de 1 segundo a partir das conexões ativas do PeerJS.
  - Encerramento síncrono e assíncrono ao fechar a aba (`beforeunload` + `pagehide` utilizando `navigator.sendBeacon` e chamada RPC).
- **Derivação de Senha PBKDF2**: Implementada nativamente com `crypto.subtle` (SHA-256 com 100.000 iterações e sal de 128 bits gerado por entropia criptográfica).
- **Resiliência e Fallback Transparente**: Se `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` não forem configurados no ambiente, o sistema utiliza o `MockRoomService` local com dados de demonstração sem quebrar a execução.

