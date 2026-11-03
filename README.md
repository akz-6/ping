# Ping

Compartilhamento de tela P2P no navegador, ideal para transmitir jogos, vídeos ou apresentações em **1080p60 / 1440p / 4K** enquanto conversa em chamadas de voz (como no Discord). O frontend estático fica na Vercel e o fluxo de vídeo viaja **diretamente do seu computador para o navegador de quem assiste** via WebRTC — o vídeo nunca passa pela Vercel.

Veja [`ARCHITECTURE.md`](./ARCHITECTURE.md) para os detalhes técnicos de protocolo, controle de acesso, adaptação de bitrate e segurança.

---

## Como usar

```text
[Anfitrião] Abre o Ping -> Escolhe 1080p / 60 FPS -> Clica em "Iniciar transmissão"
     │
     ├──> Link copiado: https://seu-ping.vercel.app/?room=ping-x7k2m9p4q8w3
     │
[Espectador] Abre o link no navegador (PC ou celular) -> Assiste em tempo real (100–300 ms)
```

### Para quem transmite (Anfitrião)
1. Acesse a página inicial do Ping no Chrome, Edge ou Firefox (computador).
2. Escolha a **Taxa de quadros** (`30` ou `60 FPS`), **Resolução** (`720p` a `4K`), **Bitrate máximo por espectador** (`4` a `20 Mbps`) e **Tipo de conteúdo** (*Jogo / vídeo* para priorizar fluidez ou *Texto / slides* para priorizar nitidez).
3. *(Opcional)* Abra **Opções avançadas de vídeo, rede e acesso** para:
   - Ajustar a **Preferência de codec** (`VP9`, `AV1`, `H.264` ou `VP8`).
   - Informar **Meu upload em Mbps** para receber alertas caso o número de espectadores ultrapasse sua banda.
   - Definir **Máximo de espectadores**, **Senha da sala** (verificada via hash SHA-256) e **Exigir aprovação manual** para cada espectador.
4. Clique em **Iniciar transmissão**, selecione a tela, janela ou aba (marque *Compartilhar áudio do sistema* na janela do navegador se desejar som) e envie o link copiado para os amigos.
5. Durante a transmissão, acompanhe a tabela em tempo real com **Codec, Bitrate, FPS, RTT e Limitação** por espectador, podendo **Remover** ou **Bloquear** qualquer participante a qualquer momento.

### Para quem assiste (Espectador)
1. Abra o link `?room=ping-...` em qualquer navegador moderno (desktop ou celular), sem instalar nada.
2. Se a sala tiver senha ou aprovação manual, digite a senha ou aguarde o anfitrião aceitar.
3. O vídeo inicia automaticamente (começa mudo por exigência de autoplay dos navegadores — clique em **Ativar som** ou pressione `M`).
4. **Atalhos e controles do reprodutor:**
   - `M`: ativar som / silenciar.
   - `F` ou **duplo clique no vídeo**: alternar tela cheia.
   - A barra inferior e o cursor do mouse se ocultam automaticamente após **3 segundos** sem movimento.
   - O indicador de qualidade (**Boa**, **Média**, **Ruim**) resume em tempo real a saúde da recepção com base em latência (RTT), perda de pacotes e taxa de quadros.

---

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`, clique em **Iniciar transmissão**, copie o link da sala e abra em outra aba ou dispositivo. `localhost` é aceito pelos navegadores como contexto seguro para captura de tela (`getDisplayMedia`).

### Comandos disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor de desenvolvimento Vite em `http://localhost:5173`. |
| `npm run build` | Executa a checagem estrita de tipos (`tsc --noEmit`) e gera o bundle de produção em `dist/`. |
| `npm run preview` | Serve o bundle gerado em `dist/` localmente para conferência. |
| `node scripts/contrast.mjs` | Valida contrastes WCAG AA (mínimo 4.5:1 para texto e 3:1 para UI) nas 6 combinações de tema/paleta. |
| `npm run test:e2e` | Executa a suíte de testes ponta a ponta (E2E) via Playwright cobrindo Lobby, modais, responsividade e transmissão P2P. |

---

## Lobby e Sistema de Design (Fase L1–L4)

A interface do Ping foi redesenhada com base nas especificações do Figma (`MNxrW5u2UPqTi8Fvw6dGuG`):

- **Layout em 3 colunas**:
  - **Sidebar de Navegação (esquerda)**: acesso rápido a Salas, Criar Sala, Perfil de usuário anônimo (`user{8 dígitos}`) e configurações.
  - **Feed Central**: listagem dinâmica dividida entre **Salas Abertas** (com limite global de até 5 simultâneas) e **Salas Fechadas** (protegidas por senha).
  - **Coluna de Anúncios (direita)**: slots responsivos (`300×250` e `300×600` no desktop; `320×100` no tablet; cards intercalados no mobile).
- **Temas e Paletas**:
  - Alternância instantânea entre **Modo Claro** e **Modo Escuro**.
  - 3 paletas de marca: **Indigo**, **Teal** e **Terracota**.
  - Persistência em `localStorage` (`ping:theme` e `ping:palette`) com script de inicialização precoce (`theme-init.js`), prevenindo qualquer flash de conteúdo não estilizado (FOUC).
- **Acessibilidade WCAG AA**:
  - Tecla `/` para focar rapidamente na busca de salas; `Esc` para limpar ou fechar modais.
  - Alternador de visibilidade de senha com anúncio via leitor de tela (`aria-pressed`).
  - Salas lotadas desabilitadas com preservação de foco e aviso auditivo.
  - Bloqueio por 30 segundos após 3 tentativas incorretas de senha.

Consulte [`DECISIONS.md`](./DECISIONS.md) para o detalhamento completo dos tokens de design, acessibilidade e arquitetura.

---

## Publicar na Vercel (Checklist de Deploy)

1. Suba este diretório para um repositório no GitHub, GitLab ou Bitbucket.
2. Na Vercel, clique em **Add New → Project** e importe o repositório.
   - O arquivo [`vercel.json`](./vercel.json) já configura automaticamente o framework Vite (`npm run build`, saída em `dist`) e os cabeçalhos de segurança (`Content-Security-Policy` com `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy` e `Permissions-Policy`).
3. *(Opcional)* Em **Settings → Environment Variables**, configure as variáveis descritas em [`.env.example`](./.env.example) caso utilize servidor TURN ou PeerServer próprio.
4. Após o deploy, valide o checklist:
   - [ ] O site abre via **HTTPS** (obrigatório para `getDisplayMedia` e `crypto.subtle`).
   - [ ] Ao clicar em **Iniciar transmissão**, o link da sala (`?room=ping-...`) é gerado e copiado.
   - [ ] Abrindo o link em outra aba/dispositivo, o vídeo aparece e o indicador de qualidade marca **Boa**.
   - [ ] *(Se configurou TURN)* Testar com um espectador em rede móvel 4G/5G para validar a travessia de CGNAT.

---

## Configurando TURN

Na maioria das conexões residenciais o WebRTC conecta diretamente (P2P via STUN). Porém, em cerca de **10 a 20% das redes** (operadoras com **CGNAT**, **NAT simétrico**, redes móveis 4G/5G ou firewalls corporativos), a conexão direta é bloqueada e exige um servidor **TURN** para retransmitir os pacotes.

### Opção 1: Serviço TURN gerenciado (com plano gratuito)
Provedores como **Metered TURN** (Open Relay / Metered.ca), **Cloudflare Realtime TURN** ou **Twilio Network Traversal** oferecem cotas gratuitas:
1. Crie uma conta no provedor escolhido e gere as credenciais TURN (`urls`, `username` e `credential`).
2. Copie `.env.example` para `.env.local` (ambiente local) ou cadastre em **Settings → Environment Variables** na Vercel:
   ```env
   VITE_TURN_URLS=turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443?transport=tcp
   VITE_TURN_USERNAME=seu_usuario_turn
   VITE_TURN_CREDENTIAL=sua_credencial_turn
   ```

### Opção 2: Servidor próprio com `coturn`
Se você possui uma VPS Linux com IP público (ex.: Ubuntu/Debian):
1. Instale o `coturn`: `sudo apt update && sudo apt install coturn`.
2. Edite `/etc/turnserver.conf`:
   ```ini
   listening-port=3478
   tls-listening-port=5349
   fingerprint
   lt-cred-mech
   realm=seudominio.com
   user=usuario_turn:senha_exclusiva_turn
   no-multicast-peers
   no-cli
   ```
3. Libere as portas `3478` e `5349` (UDP/TCP) no firewall e preencha `VITE_TURN_URLS`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL`.

> **Aviso de segurança:** Qualquer variável prefixada com `VITE_*` é incluída no código estático enviado ao navegador e **fica visível no DevTools**. Nunca coloque senhas pessoais nelas. Dê preferência a credenciais TURN temporárias (com expiração/TTL) ou configure limites de tráfego e restrição de domínio (`Origin`) no painel do seu provedor TURN.

---

## Sinalização própria opcional (PeerServer)

Por padrão, o Ping usa o **PeerJS Cloud** (`0.peerjs.com`) gratuitamente apenas para a fase de sinalização (troca inicial de ofertas SDP e candidatos ICE). Se o servidor público estiver lento ou indisponível, você pode subir seu próprio **PeerServer** com o pacote oficial `peer` do npm.

> **Por que a Vercel Serverless NÃO serve para hospedar o PeerServer?**
> A sinalização WebRTC exige conexões **WebSocket persistentes** e estado compartilhado em memória para que o anfitrião aguarde a chegada dos espectadores durante toda a sessão. Funções Serverless da Vercel são efêmeras (executam por poucos segundos e não mantêm conexões WebSocket longas nem memória compartilhada entre invocações). Por isso, a Vercel hospeda apenas o **frontend estático**, enquanto um PeerServer próprio deve rodar em um serviço que suporte processos contínuos (Node.js/Docker).

### Como subir um PeerServer gratuito (Render, Fly.io, Railway ou VPS)

1. Em um repositório separado ou diretamente via linha de comando num serviço Node.js/Docker gratuito, execute o pacote `peer`:
   ```bash
   npx peer --port 9000 --key peerjs --path /
   ```
   Ou com um `package.json` mínimo para deploy no **Render.com** / **Railway** / **Fly.io**:
   ```json
   {
     "name": "ping-peerserver",
     "private": true,
     "scripts": {
       "start": "peerjs --port ${PORT:-9000} --key peerjs --path /"
     },
     "dependencies": {
       "peer": "^1.0.2"
     }
   }
   ```
2. Após publicar o serviço (que já fornece HTTPS/WSS automático na porta `443`), configure as variáveis de ambiente do Ping (`.env.local` ou painel da Vercel):
   ```env
   VITE_PEER_HOST=seu-peerserver.onrender.com
   VITE_PEER_PORT=443
   VITE_PEER_PATH=/
   VITE_PEER_SECURE=true
   ```
3. Para testar localmente sem internet, rode `npx peer --port 9000 --path /` em um terminal e use no `.env.local`:
   ```env
   VITE_PEER_HOST=localhost
   VITE_PEER_PORT=9000
   VITE_PEER_PATH=/
   VITE_PEER_SECURE=false
   ```

---

## Limitações conhecidas

- **Navegador do anfitrião:** precisa ser um navegador desktop com suporte a `getDisplayMedia` (Chrome, Edge ou Firefox). Quem apenas assiste pode usar qualquer navegador moderno, inclusive no celular (Android e iOS).
- **Áudio do sistema:** a captura de áudio do sistema operacional completo só é disponibilizada pelo Chrome/Edge no Windows/ChromeOS; no macOS e Linux, os navegadores permitem capturar o áudio ao compartilhar uma **aba do navegador**.
- **Upload do anfitrião (topologia mesh 1:N):** como não há servidor intermediário de mídia (SFU), cada espectador conectado recebe um fluxo direto do anfitrião. Transmitir a 8 Mbps para 3 amigos consome até ~24 Mbps de upload.
- **Redes restritas (CGNAT / NAT simétrico):** exigem a configuração de um servidor TURN para estabelecer conexão quando o P2P direto é bloqueado pelas operadoras.
- **Latência real:** a latência típica do WebRTC P2P fica entre **100 e 300 ms** (dependendo da distância física, rota da operadora e codificação de vídeo) — muito baixa para conversar no Discord, mas nunca literalmente "zero delay".
