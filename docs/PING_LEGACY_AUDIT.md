# PING — Auditoria do Legado & Mapeamento de Dependências (v3.0)

Data: 08/11/2026  
Status: Concluído antes de qualquer refatoração  

---

## 1. Arquitetura Geral & Framework
- **Framework Principal**: TypeScript nativo modularizado com Vite 5.x (`vanilla-ts`).
- **Player de Vídeo**: Video.js 8.x (`PingPlayer`) com skin customizada (`.ping-skin`) e componentes nativos registrados (`vjs-live-badge`, `vjs-quality-control`, `vjs-fps-control`, `PingTheaterButton`, `PingStatsButton`, `PingChatButton`, `PingOsd`).
- **Motor WebRTC**: PeerJS (`Peer`, `DataConnection`, `MediaConnection`) + Fallback transparente para Cloudflare Calls (SFU) via `HostTransport` e `ViewerTransport`.
- **Sinalização & Presença**: Supabase Realtime / Broadcast com lifecycle gerenciado (`startHostLifecycle`).
- **Chat**: `ChatHub` (autoridade do anfitrião com token bucket e buffer circular) + `ChatUi` (painel lateral com renderização DOM nativa).
- **Design System & Estilos**: CSS modularizado com tokens de design estritos em `src/styles/tokens.css` (0 hex fora de tokens.css).

---

## 2. Rotas e Diferenciação de Papéis

| Rota / Parâmetro | Responsável | Papel | Descrição |
|---|---|---|---|
| `/` | `src/app/app.ts` (`mountApp`) | Lobby / Navegação | Lista de salas ativas, busca, painel de amigos e modais. |
| `/studio` ou `/?host=1` | `src/host.ts` (`mountHost`) | Anfitrião (Host / Studio) | Configuração inicial da transmissão e painel de controle da live ao vivo. |
| `/?room=<id>` | `src/viewer.ts` (`mountViewer`) | Espectador (Viewer) | Palco imersivo de reprodução WebRTC com chat integrado e Video.js. |

### Diferenciação de Estado:
- **Organizador (Host)**:
  - `mountOpts.hostToken`: Token de autoridade para o ciclo de vida da sala no Supabase.
  - `startHostLifecycle`: Atualiza heartbeat, status `live`/`closed` e número de espectadores.
  - `isOwner` / `isCreatorAuthorized`: Máquina autorizada com senha mestra ou chave.
- **Espectador (Viewer)**:
  - Não possui `hostToken`. Conecta via `PeerJS` ao `peerId` derivado de `room` (`ping-room-${room}`).
  - Se a sala exigir senha, recebe handshake de desafio (`auth-challenge`) e apresenta formulário de senha (`#auth-wrap`).
  - Se a sala exigir aprovação manual, aguarda resposta do Host (`#pending-wrap` no host).

---

## 3. Inventário dos Componentes Legados & Seletores

### A. Configuração de Transmissão (`#setup` em `src/host.ts`)
- **Container**: `<section class="card" id="setup">` dentro de `<main class="shell">`.
- **Problema Crítico Identificado**: A classe `.shell` possui `max-width: 720px; margin: 0 auto;`, comprimindo toda a tela de configuração e o estúdio em uma faixa estreita, desperdiçando todo o espaço de telas desktop (como 1728x900).
- **Campos e Seletores Preservados**:
  - `#fps`: `<select id="fps">` (30, 60, 120, 144, 240 FPS).
  - `#res`: `<select id="res">` (720, 1080, 1440, 2160p).
  - `#br`: `<select id="br">` (4000, 8000, 12000, 20000 kbps).
  - `#hint`: `<select id="hint">` (motion, detail).
  - `#advanced`: `<details class="advanced" id="advanced">` (acordeão de configurações avançadas).
  - `#codec`: `<select id="codec">` (h264, vp9, av1, vp8).
  - `#bitrate-mode`: `<select id="bitrate-mode">` (fixed, adaptive).
  - `#upload-mbps`: `<input id="upload-mbps">`.
  - `#max-viewers`: `<select id="max-viewers">` (1 a 12 pessoas).
  - `#room-password`: `<input type="password" id="room-password">`.
  - `#require-approval`: `<input type="checkbox" id="require-approval">`.
  - `#audio`: `<input type="checkbox" id="audio">`.
  - `#start`: `<button id="start" class="primary">Iniciar transmissão</button>`.
  - `.host-back-link`: Link para retornar ao lobby.
  - `#p2p-human-warning`: Bloco de texto humanizado explicando consumo de upload por espectador.
  - `#setup-capacity-warn`: Alerta de capacidade estimada de upload.
  - `#unsupported`: Alerta para navegadores sem `getDisplayMedia`.

### B. Studio do Organizador (`#live` em `src/host.ts`)
- **Container**: `<section class="card" id="live" hidden>` contendo `.palco-layout.palco-layout-host#host-palco`.
- **Problema Crítico Identificado**: Os controles estavam dispersos em várias linhas flex (`.live-toolbar`, `.live-room-settings`, `.row.between`, `.live-actions`), o chat ficava espremido ao lado por conta do `max-width: 720px` do `.shell`, e a tabela de estatísticas técnicas ficava desestruturada.
- **Campos e Seletores Preservados**:
  - `#preview`: `<video id="preview">` (prévia da tela capturada).
  - `.discord-live-pill` & `.pulse-dot`: Badge de "AO VIVO".
  - `#host-paused-overlay`: Overlay quando transmissão é pausada.
  - `#host-stopped-overlay` & `#btn-resume-live`: Overlay quando transmissão é parada mantendo sala aberta.
  - `#link`: `<input id="link" readonly>` com a URL completa da sala.
  - `#copy`: `<button id="copy">Copiar link</button>`.
  - `#change-source`: `<button id="change-source">Trocar Tela</button>`.
  - `#pause-stream`: `<button id="pause-stream">Pausar Tela / Retomar Tela</button>`.
  - `#stop-stream`: `<button id="stop-stream">Parar Live / Iniciar Live</button>`.
  - `#mute-audio`: `<button id="mute-audio">Áudio Ativo / Áudio Mudo</button>`.
  - `#btn-toggle-visibility`: `<button id="btn-toggle-visibility">Sala Visível / Sala Oculta</button>`.
  - `#btn-change-password`: `<button id="btn-change-password">Alterar Senha</button>`.
  - `#btn-remove-password`: `<button id="btn-remove-password">Tirar Senha</button>`.
  - `#count`: Contador de espectadores.
  - `#capacity-info` & `#capacity-warn`: Upload estimado e aviso de estouro.
  - `#stop`: Botão perigo para encerrar a sala.
  - `#pending-wrap` & `#pending-list`: Solicitações de aprovação pendentes com `.approve-btn` e `.reject-btn`.
  - `#stats-wrap`, `#stats-body`: Tabela de estatísticas com botão `.kick-btn` e `.block-btn`.
  - `#copy-diag`: Botão de cópia de diagnóstico em JSON.
  - `#host-chat-mount`: Container onde a instância de `ChatUi` é montada.

### C. Sala do Espectador (`src/viewer.ts`)
- **Container**: `<main class="viewer ping-stage" id="stage">`.
- **Problema Crítico Identificado**: Layout antigo misturava barra de controles clássica do HTML5 sobreposta com a barra Video.js, além de modais flutuantes desalinhados.
- **Campos e Seletores Preservados**:
  - `#v`: `<video id="v">` alimentado pelo stream WebRTC e envelopado pelo Video.js.
  - `#status`: Overlay de estado de conexão ("Conectando…", erro, etc.).
  - `#pause-overlay`: Overlay informando que o host pausou o compartilhamento.
  - `#discord-stats-modal`, `#close-stats`, `#ds-status`, `#ds-rtt`, `#ds-bitrate`, `#ds-fps`, `#ds-codec`, `#ds-preset`, `#ds-chosen-fps`: Modal de estatísticas técnicas.
  - `#auth-wrap`, `#auth-form`, `#auth-pw`, `#auth-msg`, `#auth-submit`: Autenticação por senha em salas protegidas.
  - `#sound`, `#vol`, `#quality`, `#quality-preset`, `#fps-selector`, `#stats`, `#copy-diag`: Controles auxiliares e atalhos.
  - `#chat-mount`: Container do chat `ChatUi` do espectador.

---

## 4. Análise de Conflitos de CSS
1. **Larguras Fixas / Restrições no Host**:
   - `.shell` com `max-width: 720px` impede o Studio de expandir em telas largas.
   - `.palco-layout-host` com `grid-template-columns: minmax(0, 1fr) var(--chat-w)` estava dentro de um container de 720px, resultando em um palco de ~400px e chat de ~300px.
2. **Duplicação de Regras**:
   - Existiam regras para `.studio` em `src/style.css` que não eram utilizadas pelo `host.ts` (pois o host usava `.shell` e `.palco-layout-host`).
3. **Controle de Visualização Imersiva no Viewer**:
   - O viewer já possui suporte a `theater-mode` e `data-chat="visible|hidden"`. A reorganização unificará o cabeçalho compacto com link de retorno e o dock inferior alinhado às referências.

---

## 5. Plano de Execução Sem Regressões
- **Fase 2**: Consolidar tokens no `tokens.css` e criar componentes visuais compartilhados (botões, cards, selects, badges, switches).
- **Fase 3**: Reestruturar a tela de Configuração (`#setup` em `src/host.ts`) com grid de 2 colunas (`minmax(0, 1fr) 320px`), cards temáticos (Qualidade, Acesso, Áudio, Espectadores), resumo lateral com botão `((•)) INICIAR TRANSMISSÃO`, e acordeão avançado.
- **Fase 4**: Reestruturar o Studio do Organizador (`#live` em `src/host.ts`) aproveitando 100% da largura, com palco 16:9 em destaque, linha de link e cópia, cards de métricas em badges compactos, botões de ação categorizados e painel de diagnóstico expansível.
- **Fase 5**: Reestruturar a Sala do Espectador (`src/viewer.ts`) com cabeçalho compacto com botão de saída e badge AO VIVO, palco imersivo com Video.js e dock inferior unificado.
- **Fase 6**: Limpeza de classes legadas obsoletas, garantindo que nenhum seletor listado em `docs/selectors-baseline.json` seja quebrado.
- **Fase 7**: Validação com `npm run build` e execução dos 58 testes automatizados no Playwright.
