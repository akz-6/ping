# Histórico de Diagnósticos e Telemetria WebRTC - Ping

Este documento centraliza as capturas de telemetria diagnóstica reais coletadas pelo botão **"Copiar diagnóstico (JSON)"** no Host e no Espectador do Ping. Serve como base empírica contínua para calibração de codecs, estimativa de banda (BWE), ajuste de SDP, `degradationPreference` e avaliação de qualidade de conexão.

---

## Índice de Sessões Registradas

| ID | Data / Hora (UTC) | Papel | Sala | Cliente | Amostras | Rede | Resumo do Cenário |
|---|---|---|---|---|---|---|---|
| [#001](#sessão-001--2026-11-03-005754-utc) | 2026-11-03 00:57:54 | Viewer | `ping-twbbipmscqyz` | `rbm5po7k` | 12 | Loopback / LAN (RTT 0-1 ms) | Transição tela estática para movimento com rampa conservadora de resolução do Chromium (360p -> 480p). |
| [#002](#sessão--incidente-002--falha-de-conexão-em-dados-móveis-4g5g-e-redes-externas-ice-failed--cgnat) | 2026-11-02 22:26:00 | Viewer | N/A | Mobile / Amigo | N/A | Dados Móveis (4G/5G) e Redes Externas | Erro "ICE falhou (provável NAT/CGNAT). Peça ao anfitrião para configurar um servidor TURN." ao desconectar do Wi-Fi. |

---

## Sessão #001 – 2026-11-03 00:57:54 UTC

### 1. Metadados
- **Papel:** Espectador (`viewer`)
- **ID da Sala:** `ping-twbbipmscqyz`
- **ID do Cliente:** `rbm5po7k`
- **Data/Hora:** `2026-11-03T00:57:54.459Z`
- **Total de Amostras:** 12 (1 amostra/segundo durante 12 segundos)
- **Topologia de Rede:** Mesma máquina / LAN local (`rttMs` = 0 a 1 ms, `packetsLost` = 0)

### 2. Tabela de Amostras Cronológicas

| Amostra | Offset (s) | Resolução | FPS | Bitrate (kbps) | RTT (ms) | Perda (Delta) | Freezes (Total) | Jitter Buffer Delay | Status UI |
|---|---|---|---|---|---|---|---|---|---|
| **#1** | 0s | 360 × 213 | 62 | 0 | 0 | 0 (0) | 0 (0.00s) | 237 ms | `good` (Bom) |
| **#2** | 1s | 360 × 213 | 23 | 300 | 1 | 0 (0) | 1 (0.28s) | 406 ms | `poor` (Ruim) |
| **#3** | 2s | 360 × 213 | 25 | 203 | 1 | 0 (0) | 1 (0.28s) | 657 ms | `poor` (Ruim) |
| **#4** | 3s | 360 × 213 | 1 | 7 | 1 | 0 (0) | 2 (1.26s) | 657 ms | `poor` (Ruim) |
| **#5** | 4s | 360 × 213 | 1 | 7 | 0 | 0 (0) | 3 (2.27s) | 662 ms | `poor` (Ruim) |
| **#6** | 5s | 360 × 213 | 1 | 8 | 0 | 0 (0) | 4 (3.24s) | 662 ms | `poor` (Ruim) |
| **#7** | 6s | 480 × 284 | 1 | 263 | 0 | 0 (0) | 5 (4.32s) | 711 ms | `poor` (Ruim) |
| **#8** | 7s | 480 × 284 | 1 | 0 | 1 | 0 (0) | 6 (5.26s) | 711 ms | `poor` (Ruim) |
| **#9** | 8s | 480 × 284 | 1 | 0 | 1 | 0 (0) | 7 (6.26s) | 711 ms | `poor` (Ruim) |
| **#10** | 9s | 480 × 284 | 1 | 0 | 0 | 0 (0) | 8 (7.28s) | 722 ms | `poor` (Ruim) |
| **#11** | 10s | 480 × 284 | 19 | 43 | 0 | 0 (0) | 8 (7.28s) | 794 ms | `poor` (Ruim) |
| **#12** | 11s | 480 × 284 | 30 | 49 | 0 | 0 (0) | 8 (7.28s) | 873 ms | `poor` (Ruim) |

---

### 3. Diagnóstico e Análise Técnica de Engenharia WebRTC

#### A. A Rede Física Está 100% Saudável (RTT 0–1 ms, Perda Zero)
- `rttMs` oscila entre `0 ms` e `1 ms`, com jitter de rede insignificante (0 a 5 ms) e `packetsLost = 0` (zero pacotes perdidos) em todos os 12 segundos.
- O BitrateAdapter da Fase Q1 comportou-se perfeitamente: **não houve laço destrutivo de redução geométrica de bitrate**, pois a perda foi zero e o RTT permaneceu estável.

#### B. Resolução Baixa (360×213 subindo para 480×284) e Causa Raiz
- **Causa Raiz Comprovada (Hipóteses H3 e H4):** O Chromium inicia novas conexões WebRTC de vídeo com um estimador de banda muito conservador (`start-bitrate` padrão de ~300 kbps). Sem um parâmetro explícito de `x-google-start-bitrate` no SDP e sem `degradationPreference = "maintain-resolution"`, o escalonador de qualidade nativo (`QualityScaler`) do Chromium reduz agressivamente a resolução do capturador de tela para 360p / 480p para caber dentro da banda inicial presumida de 300 kbps.
- Na amostra #7, após 6 segundos, o escalonador deu o primeiro salto de rampa, subindo de `360×213` para `480×284`.
- **Solução direta para a Sub-fase Q2:**
  1. Injetar `x-google-start-bitrate=6000` e `x-google-min-bitrate=2500` nas linhas `a=fmtp` do SDP de vídeo durante a sinalização.
  2. Aplicar explicitamente `degradationPreference = "maintain-resolution"` nos parâmetros de encoding do `RTCRtpSender`. Isso instrui o encoder a manter a resolução nativa (ex: 1080p) e sacrificar apenas taxa de quadros se a banda for baixa, garantindo textos e slides legíveis.
  3. Definir `contentHint = "detail"` no track de vídeo capturado (`MediaStreamTrack`).

#### C. Queda de FPS para 1 e Bitrate de 0 a 8 kbps (Amostras #4 a #10)
- Entre os segundos 3 e 9, a tela capturada ficou **estática** (parada, sem movimento de cursor ou janelas).
- No WebRTC em navegadores modernos, a captura de tela (`getDisplayMedia`) otimiza CPU e rede: quando não há pixels alterados, o navegador para de emitir frames a 60 fps e envia apenas quadros de manutenção (*heartbeat* de 1 fps) consumindo meros 7 a 8 kbps.
- No momento em que o usuário voltou a mexer na tela (amostras #11 e #12), o FPS subiu imediatamente de 1 para 19 e depois para 30 fps (`jitterBufferEmittedCount` saltou de 63 para 112).

#### D. O Fenômeno de "Freezes" Falsos
- O WebRTC define congelamento (`freezeCount`) na estatística `inbound-rtp` quando o tempo entre a chegada de dois quadros excede `max(3 × duracaoMediaDoQuadro, 1 segundo)`.
- Quando a tela está estática, o transmissor não envia quadros novos. O decodificador do espectador, portanto, registra formalmente um "freeze" a cada segundo de inatividade, embora a imagem exibida seja estática por escolha do usuário e não por gargalo de rede.

#### E. Falso-Positivo no Indicador de Qualidade ("Ruim")
- A função `evaluateConnectionQuality` em `src/stats.ts` marca a conexão como `"poor"` (Ruim) se `(kbps > 0 && kbps < 500)` ou `(fps > 0 && fps < 12)`.
- Como a tela estava estática (1 fps e 0-8 kbps), o indicador da UI exibiu "Ruim", mesmo com a conexão física apresentando 0 ms de RTT e 0% de perda de pacotes.
- **Calibração recomendada para Q2:** A métrica de saúde da conexão deve priorizar a perda real de pacotes (`packetsLostDelta`), variação de RTT e jitter, evitando punir transmissões de tela parada como sendo "conexão ruim".

---

### 4. Payload JSON Bruto da Sessão #001

<details>
<summary>Clique para expandir o JSON original</summary>

```json
{
  "role": "viewer",
  "timestamp": "2026-11-03T00:57:54.459Z",
  "roomId": "ping-twbbipmscqyz",
  "clientId": "rbm5po7k",
  "samplesCount": 12,
  "samples": [
    {
      "timestamp": 1793667462622,
      "fps": 62,
      "kbps": 0,
      "width": 360,
      "height": 213,
      "rttMs": 0,
      "quality": "good",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 0,
      "totalFreezesDuration": 0,
      "jitterMs": 11,
      "jitterBufferDelayMs": 237,
      "jitterBufferEmittedCount": 8,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667463621,
      "fps": 23,
      "kbps": 300,
      "width": 360,
      "height": 213,
      "rttMs": 1,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 1,
      "totalFreezesDuration": 0.275,
      "jitterMs": 3,
      "jitterBufferDelayMs": 406,
      "jitterBufferEmittedCount": 31,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667464620,
      "fps": 25,
      "kbps": 203,
      "width": 360,
      "height": 213,
      "rttMs": 1,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 1,
      "totalFreezesDuration": 0.275,
      "jitterMs": 1,
      "jitterBufferDelayMs": 657,
      "jitterBufferEmittedCount": 56,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667465621,
      "fps": 1,
      "kbps": 7,
      "width": 360,
      "height": 213,
      "rttMs": 1,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 2,
      "totalFreezesDuration": 1.263,
      "jitterMs": 1,
      "jitterBufferDelayMs": 657,
      "jitterBufferEmittedCount": 57,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667466621,
      "fps": 1,
      "kbps": 7,
      "width": 360,
      "height": 213,
      "rttMs": 0,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 3,
      "totalFreezesDuration": 2.274,
      "jitterMs": 0,
      "jitterBufferDelayMs": 662,
      "jitterBufferEmittedCount": 58,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667467620,
      "fps": 1,
      "kbps": 8,
      "width": 360,
      "height": 213,
      "rttMs": 0,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 4,
      "totalFreezesDuration": 3.235,
      "jitterMs": 0,
      "jitterBufferDelayMs": 662,
      "jitterBufferEmittedCount": 59,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667468621,
      "fps": 1,
      "kbps": 263,
      "width": 480,
      "height": 284,
      "rttMs": 0,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 5,
      "totalFreezesDuration": 4.321,
      "jitterMs": 1,
      "jitterBufferDelayMs": 711,
      "jitterBufferEmittedCount": 60,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667469635,
      "fps": 1,
      "kbps": 0,
      "width": 480,
      "height": 284,
      "rttMs": 1,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 6,
      "totalFreezesDuration": 5.258,
      "jitterMs": 5,
      "jitterBufferDelayMs": 711,
      "jitterBufferEmittedCount": 61,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667470620,
      "fps": 1,
      "kbps": 0,
      "width": 480,
      "height": 284,
      "rttMs": 1,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 7,
      "totalFreezesDuration": 6.261,
      "jitterMs": 5,
      "jitterBufferDelayMs": 711,
      "jitterBufferEmittedCount": 62,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667471620,
      "fps": 1,
      "kbps": 0,
      "width": 480,
      "height": 284,
      "rttMs": 0,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 8,
      "totalFreezesDuration": 7.275,
      "jitterMs": 4,
      "jitterBufferDelayMs": 722,
      "jitterBufferEmittedCount": 63,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667472625,
      "fps": 19,
      "kbps": 43,
      "width": 480,
      "height": 284,
      "rttMs": 0,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 8,
      "totalFreezesDuration": 7.275,
      "jitterMs": 1,
      "jitterBufferDelayMs": 794,
      "jitterBufferEmittedCount": 82,
      "decoderImplementation": null
    },
    {
      "timestamp": 1793667473624,
      "fps": 30,
      "kbps": 49,
      "width": 480,
      "height": 284,
      "rttMs": 0,
      "quality": "poor",
      "packetsLost": 0,
      "packetsLostDelta": 0,
      "framesDropped": 2,
      "freezeCount": 8,
      "totalFreezesDuration": 7.275,
      "jitterMs": 0,
      "jitterBufferDelayMs": 873,
      "jitterBufferEmittedCount": 112,
      "decoderImplementation": null
    }
  ]
}
```

</details>

---

## Sessão / Incidente #002 – Falha de Conexão em Dados Móveis (4G/5G) e Redes Externas (ICE Failed / CGNAT)

### 1. Metadados e Relato de Comportamento
- **Papel:** Espectador (`viewer`) em dispositivo móvel (celular) e amigo em rede externa residencial/móvel.
- **Data/Hora:** `2026-11-02T22:26:00Z`
- **Comportamento Observado:**
  1. **Mesmo Wi-Fi:** O celular conecta à sala do computador e assiste com perfeição, sem engasgos e com latência mínima.
  2. **Dados Móveis (4G/5G):** Ao desligar o Wi-Fi do celular e usar a rede móvel, a tela do visualizador trava em tentativa de conexão e exibe o erro vermelho:
     > `"ICE falhou (provável NAT/CGNAT). Peça ao anfitrião para configurar um servidor TURN."`
  3. **Amigo Externo:** Ao testar de outro celular/residência pela internet, a conexão fica em loop infinito (*"só ficava conectando e não conectava"*) até esgotar o tempo limite de ICE.

---

### 2. Análise Técnica de Engenharia WebRTC e Causa Raiz

#### A. Por que funciona perfeitamente no mesmo Wi-Fi?
Quando o Host (computador) e o Viewer (celular) estão conectados no mesmo roteador/Wi-Fi:
- O protocolo ICE coleta candidatos do tipo **`host`** (ex: `192.168.0.15` e `192.168.0.27`).
- Esses endereços IP pertencem à mesma sub-rede privada local (LAN).
- A comunicação de pacotes de vídeo e dados viaja diretamente pelo switch do roteador sem necessidade de tradução de endereço de rede (NAT) nem saída para a internet pública. O pareamento ICE é instantâneo.

#### B. Por que falha no 4G/5G e com amigos fora de casa?
Quando o celular está nos Dados Móveis (4G/5G) ou em outra operadora:
1. **CGNAT (Carrier-Grade NAT, RFC 6598 - faixa `100.64.0.0/10`):** Operadoras de telefonia móvel (como Claro, Vivo, TIM no Brasil, e provedores de fibra com escassez de IPv4) não atribuem IPs públicos dedicados aos celulares. Milhares de celulares compartilham o mesmo IP público através de um NAT centralizado da operadora.
2. **NAT Simétrico (Symmetric NAT):**
   - No NAT Simétrico, quando o dispositivo faz uma requisição UDP para um destino $X$ (por exemplo, o servidor STUN do Google `stun.l.google.com:19302`), o roteador da operadora aloca uma porta pública $P_1$.
   - O STUN descobre e informa o candidato reflexivo (`srflx`) com a porta $P_1$.
   - Porém, quando o dispositivo tenta enviar mídia para o par $Y$ (o computador anfitrião), o NAT Simétrico aloca **outra porta completamente diferente** $P_2$.
   - Como o anfitrião tenta enviar pacotes para a porta $P_1$ (informada pelo STUN), o firewall da operadora móvel descarta todos os pacotes UDP silenciosamente!
3. **Ausência de Servidor de Retransmissão (TURN / Relay Candidates):**
   - O protocolo STUN apenas descobre endereços externos; **STUN não faz perfuração em NAT Simétrico**.
   - Para que o WebRTC funcione sob NAT Simétrico ou CGNAT duplo, a especificação WebRTC (RFC 5766 / RFC 5245) exige um servidor **TURN** (*Traversal Using Relays around NAT*).
   - O servidor TURN possui IP público fixo e atua como ponte de tráfego (relé de pacotes SRTP criptografados de ponta a ponta).
   - Como o Ping não possuía variáveis de ambiente `VITE_TURN_*` definidas, a lista de candidatos ICE continha apenas `host` e `srflx`. Sem candidatos `relay`, o pareamento esgotou as tentativas, o estado da conexão transitou para `iceConnectionState = "failed"` e o Ping disparou a mensagem de erro específica.

---

### 3. Soluções Definitivas para o Ping

O código do Ping no arquivo [src/config.ts](file:///d:/Ping/ping-projeto/ping/src/config.ts) **já foi construído desde a Fase 1 para consumir credenciais TURN nativamente**. Se as variáveis `VITE_TURN_URLS`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL` existirem no build, o `iceServers()` automaticamente adiciona o TURN nas chamadas `RTCPeerConnection`.

Abaixo estão as 3 melhores soluções práticas para habilitar o TURN:

#### Opção 1: Metered Video (TURN em Nuvem Gratuito – Recomendada, Pronta em 3 min)
A plataforma [Metered.ca](https://www.metered.ca/) fornece servidores TURN mundiais com camada gratuita permanente de **20 a 50 GB de tráfego por mês**, sem exigir cartão de crédito no cadastro. Oferece conexões nas portas 80 e 443 (UDP e TCP/TLS), contornando qualquer bloqueio de operadora ou firewall corporativo.

**Passo a passo:**
1. Crie uma conta gratuita em [https://dashboard.metered.ca/signup](https://dashboard.metered.ca/signup).
2. No painel, clique em **TURN Server** e depois na aba **Credentials**.
3. Copie as URLs fornecidas e as credenciais (`Username` e `Password` ou `API Key`).
4. Adicione as 3 variáveis no arquivo local [d:\Ping\ping-projeto\ping\.env.local](file:///d:/Ping/ping-projeto/ping/.env.local):
   ```env
   VITE_TURN_URLS="turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp"
   VITE_TURN_USERNAME="seu-username-aqui"
   VITE_TURN_CREDENTIAL="sua-senha-aqui"
   ```
5. Adicione as mesmas variáveis no painel da Vercel:
   - Acesse o projeto Ping na Vercel: `Settings` → `Environment Variables`.
   - Adicione `VITE_TURN_URLS`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL` para os ambientes `Production` e `Preview`.
6. Faça um novo deploy (`npx vercel deploy --prod`).
   *Pronto! Automaticamente celulares em 4G/5G e amigos em qualquer rede passarão a conectar imediatamente sem falha de ICE.*

#### Opção 2: Coturn em Servidor Próprio (100% Gratuito Ilimitado)
Caso queira tráfego ilimitado sem depender de cotas mensais de terceiros, é possível subir o servidor open-source padrão da indústria, o **Coturn**, em uma VPS gratuita vitalícia da **Oracle Cloud Free Tier** (Always Free VM) ou VPS de baixo custo ($3 a $4/mês na Hetzner, DigitalOcean ou OVH):

1. Instale o Coturn na máquina Linux com IP público:
   ```bash
   sudo apt update && sudo apt install -y coturn
   ```
2. Edite `/etc/turnserver.conf`:
   ```ini
   listening-port=3478
   tls-listening-port=443
   realm=ping.app
   user=pinguser:SenhaSegura123
   fingerprint
   lt-cred-mech
   # Faixa de portas para mídia UDP:
   min-port=49152
   max-port=65535
   ```
3. Abra as portas no firewall (`ufw allow 3478/tcp`, `ufw allow 3478/udp`, `ufw allow 443/tcp`, `ufw allow 49152:65535/udp`) e inicie o serviço:
   ```bash
   sudo systemctl restart coturn
   ```
4. Configure no Ping:
   ```env
   VITE_TURN_URLS="turn:ip-da-sua-vps:3478,turns:ip-da-sua-vps:443?transport=tcp"
   VITE_TURN_USERNAME="pinguser"
   VITE_TURN_CREDENTIAL="SenhaSegura123"
   ```

#### Opção 3: Cloudflare Calls / TURN Service
A Cloudflare possui serviço TURN de altíssima velocidade em sua rede Anycast global. É possível gerar credenciais dinâmicas integrando com a infraestrutura da Cloudflare.

---

### 4. Melhorias de UX no Código do Ping para o Anfitrião

Para que o usuário saiba antecipadamente se a sua sala suporta conexões externas e redes móveis:
- **Indicador de Status do TURN no Setup do Host:** Exibir um selo no card de configuração inicial:
  - Se `hasTurn() === true`: `🛡️ TURN Ativo (suporta 4G/5G e amigos externos)`.
  - Se `hasTurn() === false`: `⚠️ TURN não configurado (ideal para mesma rede/Wi-Fi; 4G/5G pode exigir TURN)`.
- **Orientação no Erro do Espectador:** Incluir botão ou link para o guia de configuração de TURN quando ocorrer falha de ICE, tornando o diagnóstico autoexplicativo.

---

## Próximos Passos de Calibração (Fase Q2)

1. **SDP Bitrate Ramp:** Configurar SDP munging com `x-google-start-bitrate=6000` para eliminar a rampa lenta de 360p -> 480p no Chromium.
2. **Degradation Preference:** Adicionar `degradationPreference = "maintain-resolution"` e `contentHint = "detail"` no sender de vídeo.
3. **Calibração de Heurística de Qualidade:** Evitar classificar como `"poor"` se `packetsLostDelta == 0` e `rttMs < 50`, mesmo quando a tela estiver estática (1 fps / baixo kbps).
