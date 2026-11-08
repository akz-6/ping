import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const adsTxtPath = path.join(rootDir, "public", "ads.txt");

const rawClientId = process.env.VITE_ADSENSE_CLIENT_ID || "";
let pubId = rawClientId.trim();

if (pubId) {
  // Converte "ca-pub-1234567890123456" -> "pub-1234567890123456"
  if (pubId.startsWith("ca-")) {
    pubId = pubId.replace(/^ca-/, "");
  }
  const content = `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`;
  fs.writeFileSync(adsTxtPath, content, "utf-8");
  console.log(`[gen-ads-txt] public/ads.txt gerado com ID: ${pubId}`);
} else {
  const placeholder = `# Ping ads.txt
# Para ativar o Google AdSense, configure a variável de ambiente VITE_ADSENSE_CLIENT_ID (ex.: ca-pub-XXXXXXXXXXXXXXXX)
# Formato: google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
`;
  fs.writeFileSync(adsTxtPath, placeholder, "utf-8");
  console.log("[gen-ads-txt] public/ads.txt gerado com comentário explicativo (VITE_ADSENSE_CLIENT_ID vazio)");
}
