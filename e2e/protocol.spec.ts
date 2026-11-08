import { expect, test } from "./fixtures";
import {
  parseToHost,
  parseToViewer,
  isValidChatMsg,
  isValidTransportInfo,
  DISCORD_AVATAR_RE,
} from "../src/protocol";
import type { ChatMsg } from "../src/chat/types";

test.describe("Protocolo (chat, transporte, identidade e validadores)", () => {
  test("DISCORD_AVATAR_RE valida estritamente URLs oficiais do CDN Discord", () => {
    // Válidos
    expect(
      DISCORD_AVATAR_RE.test("https://cdn.discordapp.com/avatars/123456789012345678/abcdef1234567890abcdef1234567890.webp?size=128"),
    ).toBe(true);
    expect(
      DISCORD_AVATAR_RE.test("https://cdn.discordapp.com/avatars/999/a_avatar.png"),
    ).toBe(true);
    expect(
      DISCORD_AVATAR_RE.test("https://cdn.discordapp.com/embed/avatars/0.png"),
    ).toBe(true);
    expect(
      DISCORD_AVATAR_RE.test("https://cdn.discordapp.com/embed/avatars/5.png"),
    ).toBe(true);

    // Inválidos
    expect(DISCORD_AVATAR_RE.test("http://cdn.discordapp.com/avatars/1/a.png")).toBe(false);
    expect(DISCORD_AVATAR_RE.test("https://evil.com/avatars/1/a.png")).toBe(false);
    expect(DISCORD_AVATAR_RE.test("https://cdn.discordapp.com/other/1/a.png")).toBe(false);
    expect(DISCORD_AVATAR_RE.test("javascript:alert(1)")).toBe(false);
    expect(DISCORD_AVATAR_RE.test("data:image/png;base64,...")).toBe(false);
  });

  test("isValidChatMsg valida campos e limites do chat", () => {
    const validMsg: ChatMsg = {
      id: "msg-123",
      ts: 1700000000000,
      kind: "user",
      authorId: "peer-viewer-1",
      name: "Gamer",
      badge: "discord",
      avatar: "https://cdn.discordapp.com/embed/avatars/2.png",
      text: "Olá pessoal!",
    };
    expect(isValidChatMsg(validMsg)).toBe(true);

    // Texto vazio
    expect(isValidChatMsg({ ...validMsg, text: "" })).toBe(false);

    // Texto > 300 caracteres
    expect(isValidChatMsg({ ...validMsg, text: "a".repeat(301) })).toBe(false);
    expect(isValidChatMsg({ ...validMsg, text: "a".repeat(300) })).toBe(true);

    // Caracteres de controle proibidos (\x00, \x07, \x1B, etc)
    expect(isValidChatMsg({ ...validMsg, text: "Texto\x00malicioso" })).toBe(false);
    expect(isValidChatMsg({ ...validMsg, text: "Texto\x07beep" })).toBe(false);

    // Avatar inválido
    expect(isValidChatMsg({ ...validMsg, avatar: "https://google.com/pic.png" })).toBe(false);

    // Nome vazio ou > 32
    expect(isValidChatMsg({ ...validMsg, name: "   " })).toBe(false);
    expect(isValidChatMsg({ ...validMsg, name: "x".repeat(33) })).toBe(false);

    // System msg não pode ter authorId
    expect(isValidChatMsg({ ...validMsg, kind: "system", authorId: "peer-1" })).toBe(false);
    expect(isValidChatMsg({ ...validMsg, kind: "system", authorId: null })).toBe(true);
  });

  test("parseToHost valida chat-send e transport-fallback", () => {
    // chat-send válido
    expect(parseToHost({ t: "chat-send", text: "Testando chat" })).toEqual({
      t: "chat-send",
      text: "Testando chat",
    });

    // chat-send rejeita texto vazio ou excessivo
    expect(parseToHost({ t: "chat-send", text: "" })).toBeNull();
    expect(parseToHost({ t: "chat-send", text: "b".repeat(301) })).toBeNull();

    // transport-fallback válido
    expect(parseToHost({ t: "transport-fallback", reason: "ice-timeout" })).toEqual({
      t: "transport-fallback",
      reason: "ice-timeout",
    });
    // transport-fallback com motivo > 120 caracteres é rejeitado
    expect(parseToHost({ t: "transport-fallback", reason: "r".repeat(121) })).toBeNull();

    // hello com ticket Discord opcional
    expect(parseToHost({ t: "hello", ticket: "jwt-token-ticket" })).toEqual({
      t: "hello",
      ticket: "jwt-token-ticket",
    });

    // tipo desconhecido é rejeitado
    expect(parseToHost({ t: "unknown-type" })).toBeNull();
    expect(parseToHost("string-payload")).toBeNull();
    expect(parseToHost(null)).toBeNull();
  });

  test("parseToViewer valida chat-history (<= 50 msgs), chat-msg, chat-rejected e transport-switch", () => {
    const validMsg: ChatMsg = {
      id: "msg-1",
      ts: 1700000000000,
      kind: "user",
      authorId: "host-peer",
      name: "Host",
      badge: "host",
      avatar: null,
      text: "Bem-vindos à live!",
    };

    // chat-msg
    expect(parseToViewer({ t: "chat-msg", msg: validMsg })).toEqual({
      t: "chat-msg",
      msg: validMsg,
    });

    // chat-history até 50 msgs
    const history50 = Array.from({ length: 50 }, (_, i) => ({
      ...validMsg,
      id: `msg-${i}`,
    }));
    expect(parseToViewer({ t: "chat-history", msgs: history50 })).toEqual({
      t: "chat-history",
      msgs: history50,
    });

    // chat-history > 50 msgs é rejeitado
    const history51 = Array.from({ length: 51 }, (_, i) => ({
      ...validMsg,
      id: `msg-${i}`,
    }));
    expect(parseToViewer({ t: "chat-history", msgs: history51 })).toBeNull();

    // chat-rejected
    expect(parseToViewer({ t: "chat-rejected", reason: "rate" })).toEqual({
      t: "chat-rejected",
      reason: "rate",
    });
    expect(parseToViewer({ t: "chat-rejected", reason: "muted" })).toEqual({
      t: "chat-rejected",
      reason: "muted",
    });
    expect(parseToViewer({ t: "chat-rejected", reason: "invalid" })).toEqual({
      t: "chat-rejected",
      reason: "invalid",
    });
    expect(parseToViewer({ t: "chat-rejected", reason: "unknown" })).toBeNull();

    // transport-switch p2p
    expect(parseToViewer({ t: "transport-switch", mode: "p2p" })).toEqual({
      t: "transport-switch",
      mode: "p2p",
    });
    expect(parseToViewer({ t: "transport-switch", mode: "other" })).toBeNull();

    // approved com transportInfo
    const approvedSfu = {
      t: "approved",
      transport: {
        mode: "sfu",
        sfu: {
          hostSessionId: "session-abc",
          tracks: [{ kind: "video", trackName: "track-1" }],
        },
      },
    };
    expect(parseToViewer(approvedSfu)).toEqual(approvedSfu);
  });
});
