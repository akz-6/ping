# Ping v2

Plataforma moderna de transmissão ao vivo e compartilhamento de tela WebRTC em ultra-baixa latência (< 100 ms), projetada para transmitir jogos, vídeos e apresentações em até **4K a 60 FPS**, com **Chat em tempo real**, **Design System Black + Gray**, player customizado baseado no **Video.js 8.x**, arquitetura de transporte híbrida **Cloudflare Calls (WebRTC SFU Anycast) + Fallback P2P Mesh com TURN**, autenticação **Discord OAuth2 v10** e conformidade total com as políticas do **Google AdSense e LGPD**.

---

## ⚡ Novidades do Ping v2

1. **Transporte Híbrido Resiliente**:
   - **Cloudflare Calls SFU**: Distribuição global Anycast na porta 443 HTTPS com cota gratuita de 1 TB (1.000 GB) de tráfego mensal, furando qualquer CGNAT ou firewall restritivo sem sobrecarregar o upload do anfitrião.
   - **Fallback Automático P2P / TURN**: Se a API da Cloudflare falhar ou a cota esgotar, o anfitrião e os espectadores caem instantaneamente para conexão direta P2P com servidores de relay Metered TURN / OpenRelay.
   - **Failover granular por espectador**: Se um espectador específico tiver problemas de rota para o SFU, ele solicita `transport-fallback` e recebe o stream diretamente via P2P.
2. **Player Customizado (Video.js 8.x)**:
   - Interface Black + Gray inspirada no player de referência, totalmente integrada com aceleração por hardware e `HTMLVideoElement.srcObject`.
   - Menus nativos de **Resolução**, **Taxa de quadros (FPS)**, **Modo Teatro**, **Picture-in-Picture (PiP)**, **Tela Cheia** e **Estatísticas de Conexão** detalhadas.
   - Suporte a container queries e dimensionamento responsivo com zero inline styles (CSP estrita).
3. **Palco & Chat em Tempo Real**:
   - Chat ao vivo integrado ao palco de transmissão, renderizado com layout colapsável no desktop e gaveta inferior no mobile.
   - **Autoridade total do host**: Mensagens validadas, carimbadas com timestamp e distribuídas pelo anfitrião via canal de controle PeerJS.
   - **Proteção anti-spam**: Token bucket (1 msg/1,2s, burst de 3), silenciamento de 30s após infrações repetidas e sanitização estrita via `textContent` (zero injeção HTML).
4. **Autenticação Discord (OAuth2 v10)**:
   - Login com Discord via fluxo OAuth2 v10 seguro com cookies HttpOnly assinados (HMAC-SHA256).
   - Prova criptográfica de identidade P2P: tickets efêmeros assinados no servidor evitam personificação ou falsificação de badges de usuário verificado no chat.
   - Reconhecimento automático de administradores/donos via `OWNER_DISCORD_IDS`.
5. **Monetização Responsável (Google AdSense & LGPD)**:
   - **Isolamento de rotas**: Anúncios existem exclusivamente no feed do Lobby. O palco (`/studio` e `/?room=`) utiliza CSP estrita com zero anúncios.
   - Sem Layout Shift (CLS = 0) com slots fixos e script pré-build automatizado de `ads.txt`.
   - Páginas legais completas em conformidade com a LGPD e políticas do Google: Privacidade (`/privacy.html`), Termos de Uso (`/terms.html`) e Contato (`/contact.html`).
   - Contato oficial: `cupboardofdrawings@gmail.com`.
6. **Segurança Reforçada & Chave Mestra**:
   - Chave do anfitrião (`0604`) e criação de salas validadas exclusivamente no backend (`api/rooms.ts`), impedindo vazamento em bundles de frontend.
   - Limite global de 2 salas simultâneas para o público geral; criação acima do limite restrita aos donos.

---

## 🚀 Como Usar

### Para o Anfitrião (Host)
1. Acesse o Ping no Chrome, Edge ou Firefox (desktop).
2. Opcionalmente, faça login com sua conta do Discord para exibir seu nome e avatar verificados.
3. Clique em **Criar Sala**, defina nome, senha opcional e configurações de transmissão (30/60 FPS, até 4K).
4. Ao clicar em **Iniciar transmissão**, selecione a tela ou janela desejada (marque *Compartilhar áudio do sistema* se desejar som).
5. O link fixo da sala é copiado. Enquanto a sala estiver aberta, você pode pausar e retomar a live a qualquer momento sem que o link mude.
6. Gerencie pedidos de aprovação, chute e bloqueio de participantes, além de interagir pelo chat integrado.

### Para o Espectador (Viewer)
1. Abra o link `https://seu-dominio.com.br/?room=ping-...` no computador ou celular.
2. Digite seu apelido ou conecte seu Discord. Caso a sala possua senha ou aprovação, forneça os dados solicitados.
3. Assista com latência ultra-baixa (< 100 ms), envie mensagens no chat e ajuste qualidade, áudio e tela cheia diretamente no player.

---

## 🛠️ Configuração e Variáveis de Ambiente

Copie o arquivo de exemplo para configurar seu ambiente local:

```bash
cp .env.example .env.local
```

### 1. Administração do Servidor
| Variável | Descrição |
|---|---|
| `OWNER_KEY` | Chave mestra do anfitrião (`0604`). Permite criar salas além do limite de capacidade. |
| `OWNER_DISCORD_IDS` | IDs de usuários do Discord com privilégios de anfitrião/dono (separados por vírgula). |
| `SESSION_SECRET` | Chave secreta de no mínimo 32 caracteres para assinatura HMAC-SHA256 de sessões e tickets. |

### 2. Autenticação Discord (OAuth2 v10)
1. Acesse o [Discord Developer Portal](https://discord.com/developers/applications) e crie uma nova aplicação.
2. Em **OAuth2 → General**, copie o **Client ID** e gere um **Client Secret**.
3. Adicione o **Redirect URI** exato:
   - Desenvolvimento: `http://localhost:5173/api/discord-auth?action=callback`
   - Produção: `https://seu-dominio.com.br/api/discord-auth?action=callback`
4. Preencha as variáveis:
   ```env
   DISCORD_CLIENT_ID=seu_client_id
   DISCORD_CLIENT_SECRET=seu_client_secret
   DISCORD_REDIRECT_URI=http://localhost:5173/api/discord-auth?action=callback
   ```
> ⚠️ **Atenção:** O Discord OAuth2 não aceita URLs curingas (`*`). Portanto, URLs de preview da Vercel (`*-git-*.vercel.app`) não funcionam com login Discord a menos que cadastradas manualmente no portal do Discord.

### 3. Cloudflare Calls (WebRTC SFU Anycast)
1. Acesse o painel da [Cloudflare](https://dash.cloudflare.com/) e navegue até **Calls**.
2. Crie uma nova aplicação de Calls para obter o **App ID** e o **App Secret**.
3. Preencha as variáveis (mantidas 100% no servidor em `api/calls.ts`):
   ```env
   CF_CALLS_APP_ID=seu_cloudflare_calls_app_id
   CF_CALLS_APP_SECRET=seu_cloudflare_calls_app_secret
   VITE_TRANSPORT_MODE=auto
   ```
   - `auto`: Tenta utilizar a Cloudflare Calls SFU. Se indisponível, cai automaticamente para P2P (Recomendado).
   - `p2p`: Força modo P2P direto com fallback TURN.
   - `sfu`: Força SFU sem checagem prévia.

### 4. Servidores TURN / STUN (Metered.ca / OpenRelay)
Para permitir que o modo P2P fure firewalls simétricos e CGNAT móvel 4G/5G quando a Cloudflare não for utilizada:
1. Obtenha uma conta gratuita em [metered.ca/tools/openrelay](https://www.metered.ca/tools/openrelay/).
2. Preencha as variáveis de servidor:
   ```env
   METERED_DOMAIN=seu-dominio.metered.live
   METERED_API_KEY=sua_api_key_metered
   ```

### 5. Monetização Google AdSense & ads.txt
1. Cadastre-se no [Google AdSense](https://adsense.google.com/).
2. Obtenha seu ID de cliente (ex.: `ca-pub-1234567890123456`).
3. Preencha no `.env.local`:
   ```env
   VITE_ADSENSE_CLIENT_ID=ca-pub-1234567890123456
   ```
4. Ao rodar `npm run build`, o script `scripts/gen-ads-txt.mjs` gera automaticamente o arquivo `public/ads.txt` no formato oficial exigido pelo Google:
   ```text
   google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
   ```
> ⚠️ **Exigência Crítica do AdSense**: O Google AdSense **não aprova** domínios de terceiros como `*.vercel.app`. Para aprovar sua conta, é obrigatório registrar um domínio próprio (ex.: `.com` ou `.com.br`), adicioná-lo ao painel da Vercel e submetê-lo à análise do Google. Além disso, as páginas legais de [Privacidade](/privacy.html), [Termos de Uso](/terms.html) e [Contato](/contact.html) já estão inclusas e acessíveis no rodapé para cumprir os requisitos de conteúdo e transparência.

---

## 💻 Desenvolvimento Local

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor Vite com proxy local das API routes
npm run dev

# 3. Executar checagem de tipos e build de produção
npm run build

# 4. Executar suíte completa de testes E2E Playwright
npm run test:e2e
```

---

## 🔒 Segurança e Content Security Policy (CSP)

O Ping v2 implementa uma arquitetura de segurança de camada dupla via `vercel.json` e middleware de desenvolvimento do Vite:
- **Lobby (`/`)**: CSP configurada para autorizar scripts, frames e conexões necessários para o Google AdSense, imagens de avatar do Discord (`cdn.discordapp.com`) e conexões WebRTC/WebSocket.
- **Palco e Transmissão (`/studio` e `/?room=`)**: CSP estrita que proíbe qualquer script de publicidade ou terceiros, garantindo máxima performance, privacidade e zero distrações durante a transmissão.
- **Zero Inline Styles**: O projeto segue o padrão rigoroso de ausência de atributos `style="..."` em HTML gerado em runtime, viabilizando o uso de `style-src 'self'`.

---

## 📄 Informações Legais & Contato

- **Contato Oficial**: [cupboardofdrawings@gmail.com](mailto:cupboardofdrawings@gmail.com)
- **Política de Privacidade**: `/privacy.html`
- **Termos de Serviço**: `/terms.html`
- **Canal de Atendimento**: `/contact.html`
