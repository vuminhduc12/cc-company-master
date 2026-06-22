import type { WatchStatus } from "@/types";

// 内部の判定値（WatchStatus）は維持しつつ、表示ラベルだけを
// 「売買推奨」ではなく「スクリーニング上の注目度」を表す日本語に変換する。
// 金融商品取引法上の投資助言と受け取られるリスクを下げるための表示方針。
export const watchStatusLabels: Record<WatchStatus, string> = {
  "Strong Buy": "最注目",
  Buy: "注目",
  Watch: "監視",
  Caution: "注意",
  Sell: "警戒"
};

export function watchStatusLabel(value: string): string {
  return (watchStatusLabels as Record<string, string>)[value] ?? value;
}

export const screeningDisclaimer =
  "表示は当ツールのスクリーニング上の注目度であり、特定銘柄の売買を推奨するものではありません。";
