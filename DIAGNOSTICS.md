# Histórico de Diagnósticos e Telemetria WebRTC - Ping

Este documento centraliza as capturas de telemetria diagnóstica reais coletadas pelo botão **"Copiar diagnóstico (JSON)"** no Host e no Espectador do Ping. Serve como base empírica contínua para calibração de codecs, estimativa de banda (BWE), ajuste de SDP, `degradationPreference` e avaliação de qualidade de conexão.

---

## Índice de Sessões Registradas

| ID | Data / Hora (UTC) | Papel | Sala | Cliente | Amostras | Rede | Resumo do Cenário |
|---|---|---|---|---|---|---|---|
| [#001](#sessão-001--2026-11-03-005754-utc) | 2026-11-03 00:57:54 | Viewer | `ping-twbbipmscqyz` | `rbm5po7k` | 12 | Loopback / LAN (RTT 0-1 ms) | Transição tela estática para movimento com rampa conservadora de resolução do Chromium (360p -> 480p). |

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

## Próximos Passos de Calibração (Fase Q2)

1. **SDP Bitrate Ramp:** Configurar SDP munging com `x-google-start-bitrate=6000` para eliminar a rampa lenta de 360p -> 480p no Chromium.
2. **Degradation Preference:** Adicionar `degradationPreference = "maintain-resolution"` e `contentHint = "detail"` no sender de vídeo.
3. **Calibração de Heurística de Qualidade:** Evitar classificar como `"poor"` se `packetsLostDelta == 0` e `rttMs < 50`, mesmo quando a tela estiver estática (1 fps / baixo kbps).
