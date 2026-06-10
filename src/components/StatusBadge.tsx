import type { Sentiment, TaskStatus, WatchStatus } from "@/types";

type StatusValue = WatchStatus | Sentiment | TaskStatus | "Bullish" | "Caution" | "Danger";

const colors: Record<string, string> = {
  "Strong Buy": "border-green-400/40 bg-green-400/15 text-green-300",
  Buy: "border-green-400/40 bg-green-400/15 text-green-300",
  Watch: "border-sky-400/40 bg-sky-400/15 text-sky-300",
  Caution: "border-yellow-300/40 bg-yellow-300/15 text-yellow-200",
  Sell: "border-red-400/40 bg-red-400/15 text-red-300",
  Positive: "border-green-400/40 bg-green-400/15 text-green-300",
  Neutral: "border-slate-400/40 bg-slate-400/15 text-slate-300",
  Negative: "border-red-400/40 bg-red-400/15 text-red-300",
  Completed: "border-green-400/40 bg-green-400/15 text-green-300",
  Running: "border-sky-400/40 bg-sky-400/15 text-sky-300",
  Pending: "border-yellow-300/40 bg-yellow-300/15 text-yellow-200",
  Error: "border-red-400/40 bg-red-400/15 text-red-300",
  Bullish: "border-green-400/40 bg-green-400/15 text-green-300",
  Danger: "border-red-400/40 bg-red-400/15 text-red-300"
};

export function StatusBadge({ value }: { value: StatusValue }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${colors[value]}`}>
      {value}
    </span>
  );
}
