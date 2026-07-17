"use client";

import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ScrollText,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Renders a <reqab-contract> segment as a formal document card.
 * The model wraps generated contract drafts in that tag (see the system
 * prompt); page.tsx splits it out of the message text and mounts this
 * component with the raw markdown, so the same source drives both the
 * in-chat preview and the PDF export.
 *
 * PDF export: browsers are the only engine that renders Arabic legal text
 * flawlessly (shaping, bidi, justification), so instead of a PDF library
 * we open a print-styled window of the already-rendered contract and let
 * the user save it as PDF from the native dialog.
 */

const MD_COMPONENTS = {
  table: ({ children }: { children?: ReactNode }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const COLLAPSED_MAX_H = 380;

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPrintHtml(opts: {
  title: string;
  type?: string;
  bodyHtml: string;
  origin: string;
}) {
  const { title, type, bodyHtml, origin } = opts;
  const dateLine = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    dateStyle: "long",
  }).format(new Date());

  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @font-face {
    font-family: "Amiri";
    src: url("${origin}/fonts/Amiri-Regular.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: "Amiri";
    src: url("${origin}/fonts/Amiri-Bold.ttf") format("truetype");
    font-weight: 700;
    font-style: normal;
  }
  @page {
    size: A4;
    margin: 20mm 18mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #352d20;
    font-family: "Amiri", serif;
    font-size: 13pt;
    line-height: 2.05;
  }
  body { padding: 24px; }
  @media print {
    body { padding: 0; }
  }
  .toolbar {
    position: fixed;
    top: 14px;
    inset-inline-start: 14px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: system-ui, sans-serif;
  }
  .toolbar button {
    border: 0;
    border-radius: 10px;
    background: #8a6a1a;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    padding: 10px 18px;
    cursor: pointer;
    font-family: inherit;
  }
  .toolbar span { font-size: 12px; color: #6e6252; }
  @media print { .toolbar { display: none; } }
  .watermark {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 0;
  }
  .watermark span {
    font-size: 150pt;
    font-weight: 700;
    color: rgba(138, 106, 26, 0.06);
    transform: rotate(-24deg);
    white-space: nowrap;
  }
  main { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; }
  header.doc {
    text-align: center;
    border-bottom: 2px solid #8a6a1a;
    padding-bottom: 14px;
    margin-bottom: 22px;
  }
  header.doc .brand {
    font-size: 15pt;
    font-weight: 700;
    color: #8a6a1a;
    letter-spacing: 0.02em;
  }
  header.doc .brand small {
    display: block;
    font-size: 9pt;
    font-weight: 400;
    color: #6e6252;
    margin-top: 2px;
  }
  header.doc h1 {
    font-size: 20pt;
    font-weight: 700;
    margin: 14px 0 4px;
  }
  header.doc .meta {
    font-size: 10.5pt;
    color: #6e6252;
  }
  h1, h2, h3, h4 { line-height: 1.7; break-after: avoid; }
  main h2 {
    font-size: 14.5pt;
    font-weight: 700;
    color: #352d20;
    border-bottom: 1px solid rgba(138, 106, 26, 0.45);
    padding-bottom: 4px;
    margin: 22px 0 10px;
  }
  main h3, main h4 {
    font-size: 13pt;
    font-weight: 700;
    margin: 16px 0 6px;
  }
  main p { margin: 0 0 10px; text-align: justify; }
  main ol, main ul { padding-inline-start: 26px; margin: 0 0 12px; }
  main li { margin-bottom: 6px; text-align: justify; }
  main strong { font-weight: 700; }
  main table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 16px;
    font-size: 11.5pt;
    break-inside: avoid;
  }
  main th, main td {
    border: 1px solid rgba(53, 45, 32, 0.35);
    padding: 7px 12px;
    text-align: start;
    vertical-align: top;
  }
  main th { background: rgba(138, 106, 26, 0.08); font-weight: 700; }
  main hr { border: 0; border-top: 1px solid rgba(53, 45, 32, 0.25); margin: 20px 0; }
  footer.doc {
    margin-top: 30px;
    border-top: 1px solid rgba(53, 45, 32, 0.25);
    padding-top: 10px;
    text-align: center;
    font-size: 9.5pt;
    color: #6e6252;
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">حفظ / طباعة PDF</button>
    <span>في نافذة الطباعة اختر «حفظ كملف PDF»</span>
  </div>
  <div class="watermark"><span>مسودة</span></div>
  <main>
    <header class="doc">
      <div class="brand">رِقَاب<small>عينٌ خبيرة على كل بند · مسودة مولّدة للمراجعة</small></div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${type ? `صيغة التمويل: ${escapeHtml(type)} · ` : ""}حُرّرت المسودة بتاريخ ${dateLine}</div>
    </header>
    ${bodyHtml}
    <footer class="doc">
      وُلّدت هذه المسودة بواسطة رِقَاب، نموذج أولي لأغراض العرض، ولا تُعد استشارة قانونية أو شرعية ملزمة،
      وتخضع لمراجعة اللجنة الشرعية والإدارة القانونية قبل الاعتماد.
    </footer>
  </main>
  <script>
    (function () {
      var go = function () { setTimeout(function () { window.print(); }, 250); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
      else window.addEventListener("load", go);
    })();
  </script>
</body>
</html>`;
}

export function ContractDraft({
  raw,
  title,
  type,
  streaming,
}: {
  raw: string;
  title?: string;
  type?: string;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);

  const docTitle = title?.trim() || "مسودة عقد تمويل";

  function downloadPdf() {
    const body = paperRef.current?.innerHTML;
    if (!body) return;
    const w = window.open("", "_blank", "width=920,height=1100");
    if (!w) {
      setPopupBlocked(true);
      return;
    }
    setPopupBlocked(false);
    w.document.write(
      buildPrintHtml({
        title: docTitle,
        type,
        bodyHtml: body,
        origin: window.location.origin,
      })
    );
    w.document.close();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(raw.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable; nothing to signal */
    }
  }

  return (
    <div className="my-5 overflow-hidden rounded-xl border border-gold/30 bg-card shadow-[0_0_30px_-14px] shadow-gold/25">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-gold/20 bg-gold/8 px-4 py-3">
        <ScrollText className="size-5 shrink-0 text-gold-bright" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{docTitle}</p>
          <p className="text-xs text-muted-foreground">
            {streaming
              ? "يُصاغ العقد بندًا بندًا…"
              : "مسودة جاهزة للمراجعة والتحميل"}
          </p>
        </div>
        {type && (
          <Badge
            variant="outline"
            className="border-gold/40 text-xs text-gold-bright"
          >
            {type}
          </Badge>
        )}
        <Badge variant="outline" className="text-xs text-muted-foreground">
          مسودة
        </Badge>
      </div>

      <div className="relative">
        <div
          className="overflow-hidden px-5 py-4"
          style={!expanded ? { maxHeight: COLLAPSED_MAX_H } : undefined}
        >
          <div ref={paperRef} className="reqab-prose contract-paper font-display">
            <Streamdown components={MD_COMPONENTS}>{raw}</Streamdown>
          </div>
        </div>
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {streaming ? (
          <p className="animate-pulse text-xs text-muted-foreground">
            اكتمال الصياغة يفعّل التحميل…
          </p>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-gold text-primary-foreground hover:bg-gold-bright"
              onClick={downloadPdf}
            >
              <Download className="size-4" />
              تحميل PDF
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={copyText}
            >
              {copied ? (
                <Check className="size-4 text-safe" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "نُسخ" : "نسخ النص"}
            </Button>
          </>
        )}
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180"
            )}
          />
          {expanded ? "طيّ العقد" : "عرض العقد كاملًا"}
        </Button>
      </div>
      {popupBlocked && (
        <p className="px-4 pb-3 text-xs text-risk">
          المتصفح منع فتح نافذة العقد؛ اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد
          المحاولة.
        </p>
      )}
    </div>
  );
}
