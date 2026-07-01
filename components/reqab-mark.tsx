import { cn } from "@/lib/utils";

/**
 * عين الرقيب — an eight-point star (two interlocked squares) holding a
 * watchful pupil. The pupil pulses while Reqab is reading a contract.
 */
export function ReqabMark({
  className,
  live = false,
}: {
  className?: string;
  live?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("text-gold", className)}
    >
      <rect
        x="11"
        y="11"
        width="26"
        height="26"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="11"
        y="11"
        width="26"
        height="26"
        stroke="currentColor"
        strokeWidth="1.6"
        transform="rotate(45 24 24)"
      />
      <circle
        cx="24"
        cy="24"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1"
      />
      <circle
        cx="24"
        cy="24"
        r="4.5"
        fill="currentColor"
        className={live ? "reqab-pupil-live" : undefined}
      />
    </svg>
  );
}
