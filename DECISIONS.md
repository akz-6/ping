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

---

## 10. Trava de Criação de Salas (Fase Fechada de Testes)

- **Proteção de Criação**: Máquinas de visitantes externos que tentarem criar salas (via sidebar, bottom nav móvel ou rota direta `/?host=1`) recebem um modal informando: *"A criação de novas salas está temporariamente indisponível. A plataforma Ping está em fase fechada de testes."*
- **Autorização da Máquina do Anfitrião**:
  - **Parâmetro de URL**: Abrir o Ping com `?admin=ping-master-2026` (ou chave personalizada via `VITE_CREATOR_KEY`) autoriza a máquina permanentemente no navegador (`localStorage`), limpando o parâmetro da barra de endereços sem recarregar.
  - **Desbloqueio Manual**: O modal de aviso oferece a opção discreta *"Acesso do desenvolvedor / anfitrião"*, permitindo digitar a chave mestra para autorização imediata.
  - **Ambiente Local**: Máquinas em `localhost` permanecem autorizadas nativamente para testes e desenvolvimento contínuo.

---

## 11. Identidade Híbrida e Salas de Demonstração (Fase L3)

- **Edição de Perfil Sem Exigência de Discord**:
  - Remoção do bloqueio que exigia autenticação prévia com Discord para edição de apelido de exibição e nome completo.
  - Usuários podem editar e salvar seu apelido e nome completo diretamente no modal de perfil, persistindo em `localStorage` e refletindo de imediato no cartão da sidebar e na criação de salas.
  - O botão de conexão com o Discord permanece disponível como integração opcional de nuvem.
  - Botão de redefinição de dados locais (`resetIdentity`) permitindo ao usuário apagar seu histórico e gerar um novo identificador anônimo a qualquer momento (em conformidade com a LGPD).
- **Catálogo de Salas de Demonstração Limpo**:
  - As salas mock antigas foram removidas.
  - O catálogo agora conta exclusivamente com duas salas de exemplo:
    1. **Sala Fechada (Exemplo)**: Exibe ocupação `2 / 5`. Ao digitar a senha de teste, exibe aviso: *"Esta é uma sala fake para teste."*
    2. **Sala Pública (Demonstração)**: Exibe status `5 / 5 Lotada`. Ao clicar para tentar entrar, notifica imediatamente: *"A sala está cheia (5 / 5 vagas ocupadas)."*

---

## 12. Anúncios, Consentimento LGPD e Monetização Responsável (Fase L4)

- **Consentimento Prévio Obrigatório (LGPD)**:
  - Nenhum anúncio ou script de terceiros é carregado antes do consentimento explícito do usuário.
  - Banner flutuante no rodapé (`#ping-consent-banner`) com opções claras: *"Aceitar e apoiar"* (anúncios personalizados de patrocinadores) e *"Apenas essenciais"* (sem rastreadores ou publicidade invasiva).
  - Preferência salva em `localStorage` (`ping:cookie_consent = "accepted" | "essential"`).
  - O usuário pode alterar suas preferências a qualquer momento no Modal de Perfil (`openProfileModal`).
- **Garantia de CLS Zero (Cumulative Layout Shift = 0)**:
  - Os slots de anúncio têm dimensões estritamente fixas e reservadas no layout:
    - `300×250` (topo da barra lateral desktop / rodapé de tablet).
    - `300×600` (inferior da barra lateral desktop - formato skyscraper).
    - `320×100` (banner mobile intercalado a cada 4 cartões de sala).
- **Lazy Loading com `IntersectionObserver`**:
  - Elementos publicitários só inicializam a renderização quando se aproximam do campo de visão do usuário (`rootMargin: "100px"`), economizando largura de banda e memória do dispositivo.
- **Suporte a Patrocinadores Diretos (Direct Sponsors)**:
  - Como alternativa sustentável e limpa a redes de anúncios programáticas pesadas, o Ping suporta criativos de patrocinadores diretos integrados ao design system.
  - Links externos utilizam obrigatoriamente `target="_blank"` e `rel="sponsored noopener"`.
  - Exibição de badge clara *"Patrocinado"* em conformidade com as diretrizes do CONAR / IAB.
- **Isolamento Rígido de Rotas**:
  - **Zero anúncios na transmissão**: Na rota de visualizador (`/?room=...`) ou durante uma transmissão ativa de host, nenhum elemento de anúncio ou banner é renderizado nem sobreposto aos controles de vídeo. Anúncios existem estritamente no Lobby.

---

## 13. Guia Operacional, Limites e Plano de Contingência

- **Como Trocar Tema e Paleta**:
  - No código: basta alterar os atributos no elemento raiz `html` (`data-theme="light|dark"` e `data-palette="indigo|teal|terracota"`).
  - Na interface: o usuário altera em tempo real no Modal de Perfil, persistindo em `localStorage` e aplicando tokens CSS correspondentes sem piscar a tela.
- **Como Rodar as Migrações do Supabase**:
  - Conectar ao dashboard do Supabase do projeto.
  - Abrir o **SQL Editor** e executar os scripts em ordem:
    1. Criação das tabelas `rooms` e tabela espelho `rooms_public` com gatilhos de sincronização.
    2. Funções RPC com `SECURITY DEFINER`: `create_room`, `heartbeat_room`, `update_viewers`, `verify_room_password`, `get_room_salt`.
    3. Adição da tabela `rooms_public` à publicação `supabase_realtime`.
- **Limites do Supabase Free Tier Observados**:
  - *500 MB de banco de dados*: Suficiente para dezenas de milhares de registros de salas com lazy cleanup.
  - *200 conexões simultâneas de Realtime*: Como as conexões de vídeo são 100% P2P entre navegadores e apenas o Lobby consome Postgres CDC, o plano suporta picos de usuários navegando sem custos adicionais.
  - *Pausa por inatividade após 7 dias*: Mitigado por visitas periódicas ou acionamento programado.
- **Plano de Contingência (Migração para Opção B)**:
  - Caso o Supabase atinja cotas de uso do plano gratuito, a arquitetura permite alternar para a **Opção B (Vercel Functions + Upstash Redis)** apenas reimplementando a interface `RoomService` ([`src/app/services/rooms.ts`](file:///D:/Ping/ping-projeto/ping/src/app/services/rooms.ts)), sem precisar alterar nenhum componente de tela ou lógica de transmissão WebRTC do produto.

---

## 14. PWA, Service Worker e Acabamento Final (Fase 5)

- **Service Worker com Cache de Shell Offline**:
  - Implementado em [`public/sw.js`](file:///D:/Ping/ping-projeto/ping/public/sw.js) para garantir abertura rápida mesmo em conexões lentas ou instáveis.
  - Pré-carrega os ativos essenciais do shell (`/`, `/index.html`, `/icon.svg`, `/manifest.webmanifest`, `/theme-init.js`).
  - **Isolamento Rígido de Mídia**: O Service Worker nunca intercepta conexões WebSocket (`wss:`), WebRTC, PeerJS (`/peerjs`) nem chamadas de mídia.
- **Manifest PWA e Atalhos de Sistema**:
  - [`public/manifest.webmanifest`](file:///D:/Ping/ping-projeto/ping/public/manifest.webmanifest) configurado com suporte a `display: standalone`, categorias de utilitário/produtividade e atalhos rápidos do sistema para *"Criar Sala"* e *"Explorar Salas"*.
- **Instalação Desacoplada no Perfil**:
  - O aplicativo captura o evento nativo `beforeinstallprompt` via [`src/app/services/pwa.ts`](file:///D:/Ping/ping-projeto/ping/src/app/services/pwa.ts) e disponibiliza a opção de instalação no Modal de Perfil sem popups invasivos.





