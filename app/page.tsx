"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  BookMarked,
  FileText,
  History,
  ImageIcon,
  Paperclip,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";

import { ContractDraft } from "@/components/contract-draft";
import { ReqabCheck, ReqabFlag, ReqabScore } from "@/components/reqab-blocks";
import { ReqabMark } from "@/components/reqab-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  chatTitle,
  deleteChat,
  getActiveChatId,
  loadChats,
  newChatId,
  saveChat,
  setActiveChatId,
  type StoredChat,
} from "@/lib/chat-store";
import { SUGGESTIONS } from "@/lib/demo";
import { cn } from "@/lib/utils";

const STREAMDOWN_COMPONENTS = {
  "reqab-score": ReqabScore,
  "reqab-flag": ReqabFlag,
  "reqab-check": ReqabCheck,
  // Streamdown's default table ships inside a padded card with
  // copy/download/fullscreen controls; render a plain table instead
  // and let .reqab-prose handle the styling.
  table: ({ children }: { children?: ReactNode }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const STREAMDOWN_ALLOWED_TAGS = {
  "reqab-score": ["value"],
  "reqab-flag": ["severity", "title", "impact"],
  "reqab-check": ["status"],
};

const STREAMDOWN_LITERAL_TAGS = ["reqab-score", "reqab-flag", "reqab-check"];

/*
 * Generated contract drafts arrive wrapped in <reqab-contract> tags. They are
 * split out of the message text before Streamdown sees it and rendered as
 * ContractDraft cards, so the raw markdown stays available for PDF export.
 */
type Segment =
  | { kind: "md"; text: string }
  | {
      kind: "contract";
      raw: string;
      title?: string;
      type?: string;
      complete: boolean;
    };

const CONTRACT_OPEN = /<reqab-contract\b([^>]*)>/g;
const CONTRACT_CLOSE = "</reqab-contract>";

// While streaming, a half-written tag would flash as raw text; trim it.
function trimPartialTag(text: string) {
  const cut = text.replace(/<\/?reqab-contract\b[^>]*$/, "");
  const lt = cut.lastIndexOf("<");
  if (lt === -1) return cut;
  const frag = cut.slice(lt);
  if (
    !frag.includes(">") &&
    ("<reqab-contract".startsWith(frag) || "</reqab-contract".startsWith(frag))
  ) {
    return cut.slice(0, lt);
  }
  return cut;
}

function parseAttrs(s: string) {
  const attrs: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function splitContractSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  CONTRACT_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTRACT_OPEN.exec(text))) {
    const before = text.slice(cursor, m.index);
    if (before.trim()) segments.push({ kind: "md", text: before });
    const attrs = parseAttrs(m[1] ?? "");
    const bodyStart = m.index + m[0].length;
    const closeIdx = text.indexOf(CONTRACT_CLOSE, bodyStart);
    if (closeIdx === -1) {
      segments.push({
        kind: "contract",
        raw: trimPartialTag(text.slice(bodyStart)),
        title: attrs.title,
        type: attrs.type,
        complete: false,
      });
      return segments;
    }
    segments.push({
      kind: "contract",
      raw: text.slice(bodyStart, closeIdx),
      title: attrs.title,
      type: attrs.type,
      complete: true,
    });
    cursor = closeIdx + CONTRACT_CLOSE.length;
    CONTRACT_OPEN.lastIndex = cursor;
  }
  const rest = trimPartialTag(text.slice(cursor));
  if (rest.trim()) segments.push({ kind: "md", text: rest });
  return segments;
}

const MAX_FILE_MB = 15;
const FALLBACK_PROMPT = "حلّل هذا المستند واكشف المخاطر والثغرات.";

const SOURCE_TITLES_AR: Record<string, string> = {
  "sama-consumer-finance-regulations": "ضوابط التمويل الاستهلاكي المحدثة (ساما)",
  "sama-finance-consumer-protection": "مبادئ حماية عملاء شركات التمويل (ساما)",
  "sama-finance-companies-law-regulation":
    "اللائحة التنفيذية لنظام مراقبة شركات التمويل",
  "sama-financial-consumer-protection-rules":
    "مبادئ وقواعد حماية عملاء المؤسسات المالية (ساما)",
  "boe-finance-companies-control-law":
    "نظام مراقبة شركات التمويل (هيئة الخبراء)",
  "boe-real-estate-finance-law": "نظام التمويل العقاري (هيئة الخبراء)",
};

function sourceTitleAr(raw: string) {
  const key = raw.replace(/\.(txt|md)$/, "").replace(/-part\d+$/, "");
  return SOURCE_TITLES_AR[key] ?? raw;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat("ar-u-nu-latn", {
  numeric: "auto",
});

function relativeTime(ts: number) {
  const minutes = Math.round((ts - Date.now()) / 60_000);
  if (minutes > -1) return "الآن";
  if (minutes > -60) return RELATIVE_TIME.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return RELATIVE_TIME.format(hours, "hour");
  return RELATIVE_TIME.format(Math.round(hours / 24), "day");
}

// Gemini can spend up to a minute thinking and searching the regulations
// library before the first token arrives; walk through the stages so the
// wait reads as work, not a hang.
const THINKING_PHRASES = [
  "الرقيب يقرأ طلبك…",
  "يفحص البنود بعين الخبير…",
  "يراجع لوائح ساما والضوابط الشرعية…",
  "يحسب الأرقام ويدقق التفاصيل…",
  "يصيغ الرد النهائي…",
];

function ThinkingIndicator() {
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setPhrase((i) => Math.min(i + 1, THINKING_PHRASES.length - 1)),
      8000
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
      <ReqabMark className="size-5" live />
      <span className="animate-pulse">{THINKING_PHRASES[phrase]}</span>
    </div>
  );
}

export default function Page() {
  const { messages, sendMessage, status, stop, error, regenerate, setMessages } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    });

  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";
  const hasConversation = messages.length > 0;

  const lastMessage = messages[messages.length - 1];
  const streamedChars =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.reduce(
          (n, p) => n + (p.type === "text" ? p.text.length : 0),
          0
        )
      : 0;

  // The stream opens (and status leaves "submitted") long before Gemini
  // emits its first token, so key the indicator on visible text instead.
  const awaitingText = busy && streamedChars === 0;

  const [chatHistory, setChatHistory] = useState<StoredChat[]>([]);
  const chatIdRef = useRef<string | null>(null);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const chats = loadChats();
    setChatHistory(chats);
    const activeId = getActiveChatId();
    const active = activeId ? chats.find((c) => c.id === activeId) : undefined;
    if (active) {
      chatIdRef.current = active.id;
      setMessages(active.messages);
    }
  }, [setMessages]);

  useEffect(() => {
    if (busy || messages.length === 0) return;
    if (!chatIdRef.current) chatIdRef.current = newChatId();
    setActiveChatId(chatIdRef.current);
    setChatHistory(
      saveChat({
        id: chatIdRef.current,
        title: chatTitle(messages),
        updatedAt: Date.now(),
        messages,
      })
    );
  }, [messages, busy]);

  const followRef = useRef(true);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) followRef.current = false;
    };
    const onTouchMove = () => {
      followRef.current = false;
    };
    const onScroll = () => {
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 80) {
        followRef.current = true;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (status === "submitted") followRef.current = true;
    if (followRef.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages.length, streamedChars, status]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFileError(null);
    const next: File[] = [];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setFileError(`«${file.name}» أكبر من ${MAX_FILE_MB} م.ب، أرفق نسخة أصغر.`);
        continue;
      }
      next.push(file);
    }
    setFiles((prev) => [...prev, ...next]);
  }

  function submit() {
    if (busy) return;
    const text = input.trim();
    if (!text && files.length === 0) return;

    let fileList: FileList | undefined;
    if (files.length > 0) {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      fileList = dt.files;
    }

    sendMessage({ text: text || FALLBACK_PROMPT, files: fileList });
    setInput("");
    setFiles([]);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  // The conversation itself stays in history (saved on every settled turn);
  // this only closes it and returns to the landing screen.
  function resetChat() {
    stop();
    setMessages([]);
    setInput("");
    setFiles([]);
    setFileError(null);
    setExpanded(new Set());
    chatIdRef.current = null;
    setActiveChatId(null);
  }

  function openChat(chat: StoredChat) {
    stop();
    chatIdRef.current = chat.id;
    setActiveChatId(chat.id);
    setMessages(chat.messages);
    setInput("");
    setFiles([]);
    setFileError(null);
    setExpanded(new Set());
  }

  function removeChat(id: string) {
    setChatHistory(deleteChat(id));
    if (chatIdRef.current === id) {
      chatIdRef.current = null;
      setActiveChatId(null);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const composer = (
    <div className="rounded-2xl border border-gold/25 bg-card/90 shadow-[0_0_40px_-12px] shadow-gold/20 backdrop-blur transition-colors focus-within:border-gold/50">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {files.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              {file.type.startsWith("image/") ? (
                <ImageIcon className="size-3.5 text-gold" />
              ) : (
                <FileText className="size-3.5 text-gold" />
              )}
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-muted-foreground/60">{formatSize(file.size)}</span>
              <button
                type="button"
                aria-label={`إزالة ${file.name}`}
                className="ms-0.5 rounded-sm p-0.5 hover:bg-accent hover:text-foreground"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={input}
        rows={hasConversation ? 1 : 3}
        placeholder="الصق نص العقد هنا، أو أرفقه ملفًا (PDF / صورة)…"
        className="max-h-64 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[0.9375rem] leading-7 outline-none placeholder:text-muted-foreground/50"
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 256)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center gap-2 px-3 pb-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/*,text/plain"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="إرفاق ملف"
          className="text-muted-foreground hover:text-gold"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4.5" />
        </Button>
        <p className="hidden text-xs text-muted-foreground/50 sm:block">
          Enter للإرسال · Shift+Enter لسطر جديد
        </p>
        <div className="flex-1" />
        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="إيقاف"
            className="rounded-full border border-gold/30"
            onClick={() => stop()}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            aria-label="إرسال"
            className="rounded-full bg-gold text-primary-foreground hover:bg-gold-bright disabled:opacity-35"
            disabled={!input.trim() && files.length === 0}
            onClick={submit}
          >
            <ArrowUp className="size-4.5" strokeWidth={2.4} />
          </Button>
        )}
      </div>
      {fileError && (
        <p className="px-4 pb-3 text-xs text-risk" role="alert">
          {fileError}
        </p>
      )}
    </div>
  );

  if (!hasConversation) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <div className="flex flex-col items-center text-center">
            <ReqabMark className="size-14 drop-shadow-[0_0_18px_color-mix(in_oklch,var(--gold)_40%,transparent)]" />
            <h1 className="mt-5 font-display text-6xl font-bold tracking-tight text-gold-bright sm:text-7xl">
              رِقَاب
            </h1>
            <p className="mt-4 text-lg font-medium text-foreground">
              عينٌ خبيرة على كل بند.
            </p>
            <p className="mt-2 max-w-lg text-sm leading-7 text-muted-foreground">
              الصق عقد التمويل أو أرفقه، وسيكشف رِقَاب الرسوم الخفية والبنود
              الخطرة والمخالفات الشرعية في ثوانٍ، ويولّد مسودات عقود متوافقة مع
              سياسات مصرف الإنماء.
            </p>
          </div>

          <div className="mt-8">{composer}</div>

          <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className="group rounded-xl border border-border bg-card/50 px-4 py-3 text-start transition-colors hover:border-gold/40 hover:bg-card"
                onClick={() => sendMessage({ text: s.prompt })}
              >
                <span className="block text-sm font-medium text-foreground group-hover:text-gold-bright">
                  {s.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {s.hint}
                </span>
              </button>
            ))}
          </div>

          {chatHistory.length > 0 && (
            <div className="mt-8">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="size-3.5 text-gold" />
                عمليات الفحص السابقة
              </p>
              <div className="flex flex-col gap-1.5">
                {chatHistory.slice(0, 8).map((chat) => (
                  <div
                    key={chat.id}
                    className="flex items-center rounded-xl border border-border bg-card/50 transition-colors hover:border-gold/40 hover:bg-card"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-4 py-2.5 text-start"
                      onClick={() => openChat(chat)}
                    >
                      <span className="block truncate text-sm font-medium text-foreground">
                        {chat.title}
                      </span>
                      <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground/70">
                        {relativeTime(chat.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف محادثة ${chat.title}`}
                      className="me-2 rounded-md p-2 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-risk"
                      onClick={() => removeChat(chat.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-10 text-center text-xs text-muted-foreground/60">
            فريق رِقَاب · هاكاثون أمد 2026 بالشراكة مع مصرف الإنماء · مسار الذكاء
            الاصطناعي التوليدي للتقنية المالية
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <ReqabMark className="size-7" live={busy} />
          <span className="font-display text-2xl font-bold text-gold-bright">
            رِقَاب
          </span>
          <Badge
            variant="outline"
            className="border-gold/30 text-[0.6875rem] text-muted-foreground"
          >
            نموذج أولي
          </Badge>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={resetChat}
          >
            <RotateCcw className="size-3.5" />
            فحص جديد
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-44 pt-8">
        <div className="flex flex-col gap-8">
          {messages.map((message) => {
            if (message.role === "user") {
              const isOpen = expanded.has(message.id);
              const text = message.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n");
              const isLong = text.length > 600;
              const fileParts = message.parts.filter((p) => p.type === "file");
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-ss-md border border-border bg-secondary/70 px-4 py-3">
                    {fileParts.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {fileParts.map((part, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 rounded-md bg-background/60 px-2 py-1 text-xs text-muted-foreground"
                          >
                            {part.mediaType?.startsWith("image/") ? (
                              <ImageIcon className="size-3.5 text-gold" />
                            ) : (
                              <FileText className="size-3.5 text-gold" />
                            )}
                            {part.filename ?? "مستند مرفق"}
                          </span>
                        ))}
                      </div>
                    )}
                    {text && (
                      <>
                        <p
                          className={cn(
                            "whitespace-pre-wrap text-[0.9375rem] leading-7",
                            isLong && !isOpen && "line-clamp-6"
                          )}
                        >
                          {text}
                        </p>
                        {isLong && (
                          <button
                            type="button"
                            className="mt-2 text-xs font-medium text-gold hover:text-gold-bright"
                            onClick={() => toggleExpanded(message.id)}
                          >
                            {isOpen ? "طيّ النص" : "عرض النص كاملًا"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            }

            const sourceTitles = Array.from(
              new Set(
                message.parts
                  .filter(
                    (p) =>
                      p.type === "source-document" || p.type === "source-url"
                  )
                  .map((p) =>
                    p.type === "source-document"
                      ? (p.title ?? p.filename)
                      : (p.title ?? p.url)
                  )
                  .filter((t): t is string => Boolean(t))
                  .map(sourceTitleAr)
              )
            );

            // While Gemini is still thinking the assistant message exists but
            // has no text yet; the thinking indicator stands in for it.
            const hasText = message.parts.some(
              (p) => p.type === "text" && p.text.trim().length > 0
            );
            if (!hasText && sourceTitles.length === 0) return null;

            return (
              <div key={message.id} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <ReqabMark className="size-5" />
                  <span className="text-sm font-semibold text-gold-bright">
                    رِقَاب
                  </span>
                </div>
                <div className="reqab-prose ps-7">
                  {message.parts.map((part, i) => {
                    if (part.type !== "text") return null;
                    return splitContractSegments(part.text).map((seg, j) =>
                      seg.kind === "contract" ? (
                        <ContractDraft
                          key={`${i}-${j}`}
                          raw={seg.raw}
                          title={seg.title}
                          type={seg.type}
                          streaming={
                            !seg.complete &&
                            busy &&
                            message.id === lastMessage?.id
                          }
                        />
                      ) : (
                        <Streamdown
                          key={`${i}-${j}`}
                          components={STREAMDOWN_COMPONENTS}
                          allowedTags={STREAMDOWN_ALLOWED_TAGS}
                          literalTagContent={STREAMDOWN_LITERAL_TAGS}
                        >
                          {seg.text}
                        </Streamdown>
                      )
                    );
                  })}
                </div>
                {sourceTitles.length > 0 && (
                  <div className="ms-7 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
                    <span className="me-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <BookMarked className="size-3.5 text-gold" />
                      استند الفحص إلى:
                    </span>
                    {sourceTitles.map((title) => (
                      <Badge
                        key={title}
                        variant="outline"
                        className="h-auto whitespace-normal border-gold/25 py-0.5 text-[0.6875rem] font-normal text-muted-foreground"
                      >
                        {title}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {awaitingText && <ThinkingIndicator />}

          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-risk/40 bg-risk/10 px-4 py-3 text-sm"
            >
              <span className="text-foreground">
                تعذّر إكمال الفحص. تحقق من الاتصال ثم أعد المحاولة.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-risk/40 hover:bg-risk/15"
                onClick={() => regenerate()}
              >
                إعادة المحاولة
              </Button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent pb-4 pt-8">
        <div className="mx-auto w-full max-w-3xl px-4">
          {composer}
          <p className="mt-2 text-center text-[0.6875rem] text-muted-foreground/50">
            رِقَاب نموذج أولي لأغراض العرض، ولا يُعد استشارة قانونية أو شرعية
            ملزمة.
          </p>
        </div>
      </div>
    </div>
  );
}
