# Ping: Arquitetura

Compartilhamento de tela P2P no navegador, hospedado na Vercel. O vídeo nunca passa pela Vercel.

## 1. Visão geral

```
        ┌──────────────────────┐
        │  Vercel (estático)   │  serve HTML/JS/CSS
        └──────────┬───────────┘
                   │ (só o site)
   ┌───────────────┴───────────────┐
   ▼                               ▼
┌────────┐   sinalização    ┌────────────┐
│  HOST  │◄────(PeerJS)────►│  VIEWER(s) │
│ (você) │   SDP + ICE      │  (amigos)  │
└───┬────┘                  └─────▲──────┘
    │        mídia WebRTC         │
    └─────────── P2P ─────────────┘
         (fallback: TURN relay)
```

Três planos independentes:

| Plano | Responsável | Custo |
|---|---|---|
| Entrega do site | Vercel (estático) | grátis |
| Sinalização (troca de SDP/ICE) | PeerJS Cloud (padrão) ou PeerServer próprio | grátis |
| Mídia (vídeo/áudio) | WebRTC P2P, com TURN só se o P2P falhar | grátis, exceto TURN |

## 2. Decisões de arquitetura (ADRs resumidos)

1. **Frontend estático sem backend próprio.** Vite + TypeScript, sem framework. A UI são duas telas simples; React seria peso morto. Deploy trivial na Vercel.
2. **PeerJS para sinalização.** Abstrai o handshake WebRTC. O ID do host vira o ID da sala. Trocável por sinalização própria (ver Fase 5).
3. **Host chama cada viewer (`peer.call`)**, não o contrário. O viewer abre o link, conecta um canal de dados ao host, e o host responde com a chamada de mídia. Assim o host controla quem entra.
4. **Canal de dados paralelo (`protocol.ts`)** validado estritamente em tempo de execução (`parseToHost` / `parseToViewer`):
   - `ToHost`: `{ t: "hello", pwHash? }` (onde `pwHash` é o digest SHA-256 hex de 64 caracteres de `${room}:${password}` calculado via `crypto.subtle`; a senha nunca trafega em texto puro).
   - `ToViewer`: `{ t: "auth-required", error?, remaining? }`, `{ t: "pending" }`, `{ t: "approved" }`, `{ t: "denied", reason? }`, `{ t: "welcome" }`, `{ t: "viewers", n }`, `{ t: "kicked" }`, `{ t: "ended" }`.
5. **Controle de acesso e segurança:**
   - **Entropia e expiração da sala:** IDs de sala usam 12 caracteres Base32 gerados com `crypto.getRandomValues` sem viés de módulo (`60 bits` de entropia, ex.: `ping-x7k2m9p4q8w3`), expirando imediatamente ao encerrar (`peer.destroy()`).
   - **Senha opcional:** verificada no host por comparação de hash SHA-256 com atraso de `1,2 s` por tentativa incorreta e bloqueio automático após `3` falhas.
   - **Aprovação manual opcional, limite de espectadores, kick e block:** o espectador aguarda em `pending` até o host aprovar (`approved` + `peer.call`) ou recusar/bloquear (`denied`). Espectadores ativos podem ser removidos (`kicked`) ou bloqueados por sessão (`blockedIds` por `peerId` e `clientId`).
   - **CSP restritiva:** `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`.
5. **Qualidade controlada por `RTCRtpSender.setParameters`** (bitrate máximo, `degradationPreference`: `maintain-framerate` para `motion` e `maintain-resolution` para `detail`) e `contentHint` na track de vídeo (`motion` para jogos, `detail` para texto/slides).
6. **Política de codec preferido:** Por padrão prioriza `VP9 → AV1 → H.264 → VP8` (configurável na UI avançada do host entre perfis liderados por VP9, AV1, H.264 ou VP8). Aplicada por conexão via `RTCRtpTransceiver.setCodecPreferences` (preservando codecs auxiliares RTX/FEC e ignorando sem erro se a API não existir) em conjunto com reordenação da linha `m=video` no `sdpTransform` da oferta inicial do PeerJS.
7. **Adaptação de bitrate e proteção contra laço de degradação (Fase Q / Q1):**
   - O `BitrateAdapter` opera em dois modos: **Fixo** (padrão, recomendado — o teto configurado pelo anfitrião nunca é reduzido automaticamente) e **Adaptativo** (opcional — reduz o teto somente sob evidência real de congestionamento de rede física mantida por $\ge 8\text{ s}$: `availableOutgoingBitrate < 90%` do teto, perda de pacotes $> 5\%$ ou RTT $> 3\times$ a linha de base).
   - O motivo `qualityLimitationReason = "bandwidth"` isolado **NUNCA** dispara redução de bitrate, eliminando o laço de realimentação onde o teto baixo forçava o encoder a reportar limitação interna de banda e reduzia o teto até 600 kbps. Limitação por CPU apenas orienta o usuário sem penalizar a banda.
   - Degradação cautelosa: passos de no máximo 15%, intervalo mínimo de 5 s entre reduções, respeitando piso seguro (40% do teto configurado e no mínimo 1.500 kbps para 720p+). Recuperação progressiva (+10% a cada 5 s) quando a rede estabilizar com banda disponível $> 120\%$ do teto e perda $< 1\%$. Ao reconectar, restaura o teto total imediatamente.
   - **Gravadores de diagnóstico com buffer circular de 5 minutos** (300 amostras a 1 Hz) no anfitrião e no espectador, exportáveis em JSON via botões "Copiar diagnóstico (JSON)" para depuração técnica precisa sem envio a terceiros.
8. **ICE com STUN público + TURN configurável por variável de ambiente.** Sem TURN, cerca de 10 a 20% das conexões (NAT simétrico, CGNAT, redes corporativas) falham.

## 3. Fluxos

### Host
1. Abre `/`, configura opções (resolução, FPS, bitrate, codec, limite de espectadores, senha opcional e aprovação manual opcional) e clica em **Iniciar transmissão**.
2. `getDisplayMedia` (FPS, resolução, áudio do sistema).
3. Cria `Peer` com ID aleatório de 12 caracteres (`60 bits` de entropia, ex.: `ping-x7k2m9p4q8w3`), com timeout de sinalização (`15 s`).
4. Gera link `https://app/?room=ping-x7k2m9p4q8w3` e copia para a área de transferência.
5. Para cada viewer que conecta no canal de dados e envia `{ t: "hello", pwHash? }`:
   - Valida bloqueio (`blockedIds`), limite máximo de espectadores (`maxViewers`), hash SHA-256 da senha (`auth-required` / `denied`) e fila de aprovação manual (`pending` → `approved` / `denied`).
   - Somente após aprovado e autenticado faz `peer.call(viewerId, stream)`.
6. Aplica limites de bitrate e preferência de codec por conexão, monitora `iceConnectionState` com *ICE restart* automático e permite remover (`kicked`) ou bloquear qualquer espectador em tempo real.

### Viewer
1. Abre o link com `?room=...`.
2. Cria `Peer` próprio, conecta no canal de dados do host enviando `metadata.clientId` e `{ t: "hello", pwHash? }`.
3. Se a sala exigir senha (`auth-required`), exibe formulário de senha, calcula `SHA-256(room + ":" + senha)` via `crypto.subtle` e reenvia `hello`. Se exigir aprovação manual (`pending`), exibe estado de espera até o host aceitar (`approved`).
4. Recebe a chamada de mídia, responde sem enviar mídia, exibe o stream no `<video>` (iniciando mudo para respeitar políticas de autoplay).
4. Se o `DataConnection`, `PeerConnection` ou a rede oscilar, tenta reconectar automaticamente com *backoff* progressivo (`1 s, 2 s, 3 s, 5 s, 8 s` — até 5 tentativas) ou imediatamente ao detectar o evento `online` do navegador, exibindo o progresso na UI.
5. Caso não consiga conectar ou esgote as tentativas, apresenta diagnóstico específico: *sala não existe*, *sinalização indisponível*, *ICE falhou (sugerindo TURN)* ou *anfitrião encerrou*.
6. Controles e experiência do espectador: barra inferior que se auto-oculta após 3 s de inatividade (ocultando também o cursor sobre o vídeo), atalhos de teclado (`F` para tela cheia, `M` para mudo), indicador visual de qualidade da conexão (`Boa`, `Média`, `Ruim` com base em RTT, perda de pacotes no intervalo, FPS e bitrate) e layout responsivo para celular (com suporte a `safe-area-inset` e fallback `webkitEnterFullscreen` no iOS).
7. PWA mínimo estático: `public/manifest.webmanifest` e ícone vetorial original `public/icon.svg` sem dependências adicionais.

## 4. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| NAT simétrico / CGNAT | viewer não conecta | TURN configurável + mensagem de diagnóstico clara |
| Upload do host | N viewers = N vezes o bitrate | limite de bitrate por viewer, aviso de capacidade |
| PeerJS Cloud instável | sala não abre | PeerServer próprio opcional via `VITE_PEER_HOST` |
| Áudio do sistema | só Chrome/Edge no Windows, e só em captura de tela inteira ou aba | detectar e avisar o usuário |
| Safari / iOS | `getDisplayMedia` indisponível para host | documentar: host em desktop; viewer funciona em qualquer navegador |
| Link vazado | qualquer um entra | aprovação manual do host + senha opcional (SHA-256) |
| HTTPS obrigatório | `getDisplayMedia` exige contexto seguro | Vercel já serve HTTPS; localhost é isento |

## 5. Estrutura de pastas

```
ping/
├── index.html
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── vite.config.ts
├── vercel.json
├── .env.example
├── ARCHITECTURE.md
├── SUPERPROMPT.md
├── public/
│   ├── icon.svg             # ícone vetorial original do app
│   └── manifest.webmanifest # manifesto PWA mínimo
├── e2e/
│   └── ping.spec.ts         # suíte E2E (Playwright)
└── src/
    ├── main.ts              # roteamento host/viewer por ?room=
    ├── config.ts            # ICE servers, constantes, env
    ├── host.ts              # captura, chamadas, controle de acesso, estatísticas
    ├── viewer.ts            # conexão, reconexão, player, atalhos e controles
    ├── media.ts             # constraints, codec, bitrate adaptativo, contentHint
    ├── protocol.ts          # tipos, validadores de protocolo e hash SHA-256
    ├── ui.ts                # helpers de DOM, toasts, clipboard, shortId
    ├── stats.ts             # getStats: recepção (viewer) e envio (host)
    └── style.css            # estilos responsivos, foco acessível e layout mobile
```

## 6. Limites honestos

- "Zero delay" é aproximação: a latência típica P2P é de 100 a 300 ms, dependendo de rede e codificação. Não é literalmente zero.
- 1080p60 consome em média 5 a 10 Mbps por viewer, mas isso varia com o conteúdo. 4K depende de hardware e upload.
- O plano grátis do Discord é o ponto de comparação, mas a qualidade final depende da sua máquina e rede, não só da arquitetura.
