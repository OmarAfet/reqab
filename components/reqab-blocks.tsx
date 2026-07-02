import {
  CircleCheck,
  CircleX,
  Info,
  OctagonAlert,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

/*
 * MDX-style blocks Reqab emits inside its markdown replies.
 * The model writes custom tags (<reqab-score>, <reqab-flag>, <reqab-check>)
 * which Streamdown lets through via allowedTags and maps to these components.
 *
 * Markdown may wrap these tags in <p>, so everything here renders as <span>
 * with block/flex display classes to keep the HTML valid.
 */

function scoreTone(value: number) {
  if (value >= 80) return "var(--safe)";
  if (value >= 60) return "var(--gold)";
  return "var(--risk)";
}

export function ReqabScore({
  value,
  children,
}: {
  value?: string | number;
  children?: ReactNode;
}) {
  const score = Math.min(100, Math.max(0, Number(value ?? 0) || 0));
  const tone = scoreTone(score);
  const r = 26;
  const c = 2 * Math.PI * r;

  return (
    <span
      className="my-4 flex items-center gap-5 rounded-xl border bg-card/70 p-4"
      style={{ borderColor: `color-mix(in oklch, ${tone} 35%, transparent)` }}
    >
      <span className="relative block shrink-0">
        <svg viewBox="0 0 64 64" className="size-20 -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={tone}
            strokeOpacity="0.15"
            strokeWidth="6"
          />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * c} ${c}`}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono text-xl font-bold leading-none"
            style={{ color: tone }}
          >
            {score}
          </span>
          <span className="mt-0.5 text-[0.625rem] text-muted-foreground">
            /100
          </span>
        </span>
      </span>
      <span className="block min-w-0">
        <span className="block text-xs font-medium text-muted-foreground">
          درجة أمان العقد
        </span>
        <span className="mt-1 block text-[0.9375rem] font-semibold leading-7 text-foreground">
          {children}
        </span>
      </span>
    </span>
  );
}

const FLAG_SEVERITIES: Record<
  string,
  { label: string; tone: string; icon: typeof OctagonAlert }
> = {
  high: { label: "خطير", tone: "var(--risk)", icon: OctagonAlert },
  medium: { label: "مقلق", tone: "var(--gold)", icon: TriangleAlert },
  low: { label: "انتبه", tone: "var(--muted-foreground)", icon: Info },
};

export function ReqabFlag({
  severity,
  title,
  impact,
  children,
}: {
  severity?: string;
  title?: string;
  impact?: string;
  children?: ReactNode;
}) {
  const s = FLAG_SEVERITIES[severity ?? "medium"] ?? FLAG_SEVERITIES.medium;
  const Icon = s.icon;

  return (
    <span
      className="my-4 block rounded-lg border bg-card/60 p-4"
      style={{
        borderColor: `color-mix(in oklch, ${s.tone} 30%, transparent)`,
      }}
    >
      <span className="flex flex-wrap items-center gap-2">
        <Icon className="size-4.5 shrink-0" style={{ color: s.tone }} />
        <span className="font-semibold text-foreground">{title}</span>
        <Badge
          variant="outline"
          className="ms-auto text-xs"
          style={{
            color: s.tone,
            borderColor: `color-mix(in oklch, ${s.tone} 45%, transparent)`,
          }}
        >
          {s.label}
        </Badge>
      </span>
      {children && (
        <span className="mt-3 block rounded-md bg-background/60 px-3 py-2.5">
          <span className="block text-xs font-medium text-muted-foreground">
            من نص العقد:
          </span>
          <span className="mt-1 block text-sm leading-7 text-foreground/90">
            {children}
          </span>
        </span>
      )}
      {impact && (
        <span className="mt-3 flex items-start gap-2 text-sm leading-6">
          <TrendingDown
            className="mt-1 size-4 shrink-0"
            style={{ color: s.tone }}
          />
          <span>
            <span className="font-medium" style={{ color: s.tone }}>
              الأثر المحتمل:
            </span>{" "}
            {impact}
          </span>
        </span>
      )}
    </span>
  );
}

const CHECK_STATUSES: Record<
  string,
  { tone: string; icon: typeof CircleCheck; label: string }
> = {
  pass: { tone: "var(--safe)", icon: CircleCheck, label: "متوافق" },
  warn: { tone: "var(--gold)", icon: TriangleAlert, label: "شبهة" },
  fail: { tone: "var(--risk)", icon: CircleX, label: "مخالفة" },
};

export function ReqabCheck({
  status,
  children,
}: {
  status?: string;
  children?: ReactNode;
}) {
  const s = CHECK_STATUSES[status ?? "warn"] ?? CHECK_STATUSES.warn;
  const Icon = s.icon;

  return (
    <span className="my-2 flex items-start gap-2.5 rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <Icon className="mt-1 size-4.5 shrink-0" style={{ color: s.tone }} />
      <span className="min-w-0 text-sm leading-7">
        <span className="font-semibold" style={{ color: s.tone }}>
          {s.label}:
        </span>{" "}
        {children}
      </span>
    </span>
  );
}
