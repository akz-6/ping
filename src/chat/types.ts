export interface ChatMsg {
  id: string; // gerado pelo host
  ts: number; // gerado pelo host (epoch ms)
  kind: "user" | "system";
  authorId: string | null; // peerId; null em system
  name: string; // 1..32, trim
  badge: "host" | "discord" | null;
  avatar: string | null; // somente https://cdn.discordapp.com/(avatars|embed/avatars)/... (regex estrita) ou null
  text: string; // 1..300, sem caracteres de controle
}
