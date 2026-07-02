import type { UIMessage } from "ai";

/*
 * Conversation history in localStorage. One key holds the full list,
 * newest first; a second key remembers which conversation is open so a
 * reload lands back in it. All storage access is best-effort: quota
 * overflows degrade (drop attachments, then oldest chats) instead of
 * throwing, and a broken storage (private mode) leaves the app working
 * with session-only history.
 */

export type StoredChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
};

const CHATS_KEY = "reqab:chats:v2";
const ACTIVE_KEY = "reqab:active-chat";
const LEGACY_KEY = "reqab:chat:v1";
const MAX_CHATS = 30;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable; nothing to remove.
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitize(raw: unknown): StoredChat[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is StoredChat => {
    const chat = c as StoredChat | null;
    return Boolean(
      chat &&
        typeof chat.id === "string" &&
        typeof chat.title === "string" &&
        Array.isArray(chat.messages)
    );
  });
}

function persist(chats: StoredChat[]): StoredChat[] {
  const capped = chats.slice(0, MAX_CHATS);
  if (safeSet(CHATS_KEY, JSON.stringify(capped))) return capped;

  // Attachments are stored as data URLs and can blow the ~5MB quota;
  // drop them first, then drop the oldest chats until the list fits.
  const stripped = capped.map((c) => ({
    ...c,
    messages: c.messages.map((m) => ({
      ...m,
      parts: m.parts.filter((p) => p.type !== "file"),
    })),
  }));
  for (let n = stripped.length; n > 0; n--) {
    const attempt = stripped.slice(0, n);
    if (safeSet(CHATS_KEY, JSON.stringify(attempt))) return attempt;
  }
  return capped; // storage unavailable — keep session-only history
}

export function newChatId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function chatTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const file = first?.parts.find((p) => p.type === "file");
  if (file?.filename) return file.filename;
  const text = first?.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
  if (!text) return "محادثة جديدة";
  const line = text.split("\n", 1)[0].trim();
  return line.length > 64 ? `${line.slice(0, 64)}…` : line;
}

export function loadChats(): StoredChat[] {
  let chats = sanitize(parseJson(safeGet(CHATS_KEY)));

  // One-time migration from the single-conversation v1 key.
  const legacyRaw = safeGet(LEGACY_KEY);
  if (legacyRaw) {
    const legacy = parseJson(legacyRaw);
    if (Array.isArray(legacy) && legacy.length > 0) {
      const messages = legacy as UIMessage[];
      chats = persist([
        {
          id: newChatId(),
          title: chatTitle(messages),
          updatedAt: Date.now(),
          messages,
        },
        ...chats,
      ]);
    }
    safeRemove(LEGACY_KEY);
  }

  return chats;
}

export function saveChat(chat: StoredChat): StoredChat[] {
  const rest = loadChats().filter((c) => c.id !== chat.id);
  const list = [chat, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
  return persist(list);
}

export function deleteChat(id: string): StoredChat[] {
  return persist(loadChats().filter((c) => c.id !== id));
}

export function getActiveChatId(): string | null {
  return safeGet(ACTIVE_KEY);
}

export function setActiveChatId(id: string | null) {
  if (id) safeSet(ACTIVE_KEY, id);
  else safeRemove(ACTIVE_KEY);
}
