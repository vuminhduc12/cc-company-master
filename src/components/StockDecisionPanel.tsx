"use client";

import type { DailyPrice, NewsItem, Stock, StockScoreAnalysis } from "@/types";

type Props = {
  stock: Stock;
  prices: DailyPrice[];
  news: NewsItem[];
  analysis: StockScoreAnalysis;
  sourceLabel: string;
};

type Level = {
  label: string;
  value: number;
  detail: string;
  tone: "support" | "resistance" | "danger" | "neutral";
};

export function StockDecisionPanel({ stock, prices, news, analysis, sourceLabel }: Props) {
  const latest = prices[prices.length - 1];
  const recent20 = prices.slice(-20);
  const recent60 = prices.slice(-60);
  const high20 = maxBy(recent20, "high", latest.high);
  const low20 = minBy(recent20, "low", latest.low);
  const high60 = maxBy(recent60, "high", latest.high);
  const supportLine = Math.min(low20, latest.ma20 || low20);
  const resistanceLine = high20;
  const dangerLine = Math.min(supportLine, latest.ma50 || supportLine);
  const upsideLine = Math.max(high20, latest.ma20 || high20);
  const extensionLine = high60;
  const volumeSpikes = recent60
    .filter((price) => price.volumeRatio >= 1.5)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
  const positiveNews = news.filter((item) => item.sentiment === "Positive").length;
  const negativeNews = news.filter((item) => item.sentiment === "Negative").length;
  const neutralNews = news.filter((item) => item.sentiment === "Neutral").length;
  const trendLabel = buildTrendLabel(latest);
  const posture = buildPosture(latest, supportLine, resistanceLine, analysis.score, negativeNews);
  const levels: Level[] = [
    { label: "短期レンジ下限", value: low20, detail: "直近20日安値。短期の押し目候補として監視。", tone: "support" },
    { label: "短期レンジ上限", value: high20, detail: "直近20日高値。上抜け確認ライン。", tone: "resistance" },
    { label: "危険ライン", value: dangerLine, detail: "MA50/短期支持線を割る水準。出来高を伴う下抜けは警戒。", tone: "danger" },
    { label: "60日高値圏", value: extensionLine, detail: "中期で再挑戦できるかを見る抵抗帯。", tone: "neutral" }
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/82 shadow-xl shadow-black/25 ring-1 ring-white/5">
      <div className="border-b border-white/10 bg-slate-950/45 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Decision Dashboard</p>
            <h3 className="mt-2 text-xl font-black text-slate-50">投資判断ページ</h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
              {stock.ticker}の価格位置、支持・抵抗、出来高、ニュース、危険ラインを1画面で確認します。売買判断ではなく、エントリー前の確認材料です。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
            <SignalTile label="現在値" value={formatPrice(latest.close, stock)} sub={`${latest.changePercent >= 0 ? "+" : ""}${latest.changePercent.toFixed(2)}%`} tone={latest.changePercent >= 0 ? "up" : "down"} />
            <SignalTile label="状態" value={posture.label} sub={trendLabel} tone={posture.tone} />
            <SignalTile label="AIスコア" value={`${analysis.score}`} sub={analysis.status} tone={analysis.score >= 6 ? "up" : analysis.score <= 3 ? "down" : "warn"} />
            <SignalTile label="ニュース" value={`${positiveNews}/${neutralNews}/${negativeNews}`} sub="Positive/Neutral/Negative" tone={negativeNews ? "warn" : positiveNews ? "up" : "default"} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] sm:p-5">
        <div className="min-w-0 space-y-4">
          <MobileDecisionBrief
            stock={stock}
            postureLabel={posture.label}
            rangeLow={supportLine}
            rangeHigh={resistanceLine}
            breakoutLine={upsideLine}
            dangerLine={dangerLine}
            nextLine={extensionLine}
            latest={latest}
            newsCount={news.length}
          />
          <div className="grid gap-3 md:grid-cols-4">
            {levels.map((level) => <LevelCard key={level.label} level={level} stock={stock} latestClose={latest.close} />)}
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-bold text-slate-100">価格帯マップ</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">直近20日レンジと現在値の位置です。</p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-300">
                Source: {sourceLabel}
              </span>
            </div>
            <RangeBar low={low20} high={high20} current={latest.close} stock={stock} />
            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
              <WatchPoint title="上抜け確認" value={`${formatPrice(upsideLine, stock)}を出来高維持で突破`} tone="up" />
              <WatchPoint title="警戒条件" value={`${formatPrice(dangerLine, stock)}を出来高増で下抜け`} tone="down" />
              <WatchPoint title="ボラ目安" value={`ATR近似 ${calculateAtrPercent(prices).toFixed(2)}%`} tone="warn" />
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <DecisionMemo
            stock={stock}
            latest={latest}
            supportLine={supportLine}
            resistanceLine={resistanceLine}
            dangerLine={dangerLine}
            high60={high60}
            newsCount={news.length}
          />
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <p className="text-sm font-bold text-slate-100">出来高急増日</p>
            <div className="mt-3 space-y-2">
              {volumeSpikes.length ? volumeSpikes.map((price) => (
                <div key={price.date} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/70 px-3 py-2 text-xs">
                  <span className="font-bold text-slate-200">{price.date}</span>
                  <span className={price.changePercent >= 0 ? "text-sky-300" : "text-red-300"}>{price.changePercent >= 0 ? "+" : ""}{price.changePercent.toFixed(2)}%</span>
                  <span className="text-slate-400">{price.volumeRatio.toFixed(2)}x</span>
                </div>
              )) : <p className="text-xs leading-5 text-slate-500">直近60日で1.5倍以上の出来高急増日は限定的です。</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <p className="text-sm font-bold text-slate-100">直近ニュース材料</p>
            <div className="mt-3 space-y-3">
              {news.slice(0, 3).map((item) => <NewsSignal key={`${item.publishedAt}-${item.title}-${item.source}`} item={item} />)}
              {!news.length ? <p className="text-xs leading-5 text-slate-500">この銘柄のニュースはまだ取得されていません。ニュース未取得は材料なしではなく、データ不足として扱います。</p> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MobileDecisionBrief({
  stock,
  postureLabel,
  rangeLow,
  rangeHigh,
  breakoutLine,
  dangerLine,
  nextLine,
  latest,
  newsCount
}: {
  stock: Stock;
  postureLabel: string;
  rangeLow: number;
  rangeHigh: number;
  breakoutLine: number;
  dangerLine: number;
  nextLine: number;
  latest: DailyPrice;
  newsCount: number;
}) {
  const isAboveMa = latest.close >= latest.ma20 && latest.close >= latest.ma50;

  return (
    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] p-4 md:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Key Lines</p>
          <p className="mt-1 text-lg font-black text-slate-50">{stock.ticker} 重要判断カード</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-slate-950/50 px-3 py-1 text-xs font-black text-cyan-100">{postureLabel}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <BriefMetric label="短期レンジ" value={`${formatPrice(rangeLow, stock)} - ${formatPrice(rangeHigh, stock)}`} />
        <BriefMetric label="上抜け確認" value={formatPrice(breakoutLine, stock)} tone="up" />
        <BriefMetric label="危険ライン" value={formatPrice(dangerLine, stock)} tone="down" />
        <BriefMetric label="次の抵抗帯" value={formatPrice(nextLine, stock)} tone="warn" />
      </div>

      <div className="mt-4 space-y-2 text-xs leading-5 text-slate-300">
        <p>・{isAboveMa ? "MA20/MA50上で、トレンドはまだ崩れていません。" : "主要移動平均を下回っており、下値確認が優先です。"}</p>
        <p>・{formatPrice(dangerLine, stock)}を出来高増で割ると、深い調整シナリオを警戒します。</p>
        <p>・ニュース取得は{newsCount}件です。少ない場合は材料不足として扱います。</p>
      </div>
    </div>
  );
}

function BriefMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "warn" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-sm font-black tabular-nums ${toneText(tone)}`}>{value}</p>
    </div>
  );
}

function SignalTile({ label, value, sub, tone = "default" }: { label: string; value: string; sub: string; tone?: "default" | "up" | "down" | "warn" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-2 break-words text-lg font-black ${toneText(tone)}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{sub}</p>
    </div>
  );
}

function LevelCard({ level, stock, latestClose }: { level: Level; stock: Stock; latestClose: number }) {
  const distance = latestClose > 0 ? (level.value - latestClose) / latestClose * 100 : 0;
  const color = {
    support: "border-cyan-300/25 bg-cyan-300/[0.06] text-cyan-100",
    resistance: "border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-100",
    danger: "border-red-400/25 bg-red-400/[0.08] text-red-100",
    neutral: "border-white/10 bg-white/[0.04] text-slate-100"
  }[level.tone];

  return (
    <div className={`rounded-2xl border p-4 ${color}`}>
      <p className="text-[11px] font-bold text-slate-400">{level.label}</p>
      <p className="mt-2 text-xl font-black tabular-nums">{formatPrice(level.value, stock)}</p>
      <p className="mt-1 text-xs text-slate-400">現在値から {distance >= 0 ? "+" : ""}{distance.toFixed(2)}%</p>
      <p className="mt-3 text-xs leading-5 text-slate-400">{level.detail}</p>
    </div>
  );
}

function RangeBar({ low, high, current, stock }: { low: number; high: number; current: number; stock: Stock }) {
  const position = high > low ? Math.min(Math.max((current - low) / (high - low) * 100, 0), 100) : 50;

  return (
    <div className="mt-5">
      <div className="relative h-3 rounded-full bg-slate-800">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-400/75 via-cyan-300/75 to-emerald-300/80" style={{ width: "100%" }} />
        <div className="absolute top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-full bg-slate-50 shadow-lg shadow-black/30" style={{ left: `calc(${position}% - 3px)` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
        <span>{formatPrice(low, stock)}</span>
        <span className="font-bold text-slate-100">現在 {formatPrice(current, stock)}</span>
        <span>{formatPrice(high, stock)}</span>
      </div>
    </div>
  );
}

function WatchPoint({ title, value, tone }: { title: string; value: string; tone: "up" | "down" | "warn" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
      <p className={`font-bold ${toneText(tone)}`}>{title}</p>
      <p className="mt-1 leading-5 text-slate-400">{value}</p>
    </div>
  );
}

function DecisionMemo({ stock, latest, supportLine, resistanceLine, dangerLine, high60, newsCount }: { stock: Stock; latest: DailyPrice; supportLine: number; resistanceLine: number; dangerLine: number; high60: number; newsCount: number }) {
  const isAboveMa = latest.close >= latest.ma20 && latest.close >= latest.ma50;
  const isHighVolume = latest.volumeRatio >= 1.2;

  return (
    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
      <p className="text-sm font-bold text-cyan-100">判断メモ</p>
      <p className="mt-3 text-sm leading-7 text-slate-200">
        私が今の{stock.ticker}をデータだけで見るなら、短期は{formatPrice(supportLine, stock)}〜{formatPrice(resistanceLine, stock)}の価格帯をまず監視します。
        {isAboveMa ? " 終値がMA20/MA50の上にあり、トレンドは崩れていません。" : " 終値が主要移動平均を下回っており、上値追いよりも下値確認を優先する局面です。"}
        {isHighVolume ? " 出来高も平均を上回っているため、価格帯の上抜け/下抜けは材料として重く見ます。" : " 出来高が強くないため、上抜け確認には出来高の再加速が必要です。"}
        危険シナリオは{formatPrice(dangerLine, stock)}を出来高を伴って明確に割ることです。逆に{formatPrice(resistanceLine, stock)}を維持して上抜けるなら、次は60日高値圏の{formatPrice(high60, stock)}を意識します。
      </p>
      <p className="mt-3 text-xs leading-5 text-slate-400">ニュース取得件数: {newsCount}件。ニュースが少ない場合は、材料なしではなくデータ不足として扱います。</p>
    </div>
  );
}

function NewsSignal({ item }: { item: NewsItem }) {
  const tone = item.sentiment === "Positive" ? "up" : item.sentiment === "Negative" ? "down" : "default";
  return (
    <article className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold leading-5 text-slate-100">{item.title}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${sentimentClass(tone)}`}>{item.sentiment}</span>
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{item.summary}</p>
      <p className="mt-2 text-[11px] text-slate-600">{item.publishedAt} / Impact {item.impactScore}</p>
    </article>
  );
}

function buildTrendLabel(latest: DailyPrice) {
  if (latest.close >= latest.ma20 && latest.ma20 >= latest.ma50) return "MA20/MA50上";
  if (latest.close >= latest.ma20) return "短期反発";
  if (latest.close < latest.ma20 && latest.close < latest.ma50) return "下値警戒";
  return "中立";
}

function buildPosture(latest: DailyPrice, supportLine: number, resistanceLine: number, score: number, negativeNews: number) {
  if (latest.close < supportLine || negativeNews >= 2) return { label: "警戒", tone: "down" as const };
  if (latest.close >= resistanceLine * 0.98 && latest.volumeRatio >= 1.2 && score >= 5) return { label: "上抜け監視", tone: "up" as const };
  if (score >= 5 && latest.close >= latest.ma20) return { label: "継続監視", tone: "up" as const };
  if (latest.rsi >= 70) return { label: "過熱注意", tone: "warn" as const };
  return { label: "様子見", tone: "default" as const };
}

function calculateAtrPercent(prices: DailyPrice[]) {
  const target = prices.slice(-15);
  if (target.length < 2) return 0;
  const ranges = target.slice(1).map((price, index) => {
    const previousClose = target[index].close;
    return Math.max(price.high - price.low, Math.abs(price.high - previousClose), Math.abs(price.low - previousClose));
  });
  const atr = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  const latestClose = target[target.length - 1]?.close ?? 0;
  return latestClose > 0 ? atr / latestClose * 100 : 0;
}

function maxBy(prices: DailyPrice[], key: "high" | "low", fallback: number) {
  if (!prices.length) return fallback;
  return Math.max(...prices.map((price) => price[key]));
}

function minBy(prices: DailyPrice[], key: "high" | "low", fallback: number) {
  if (!prices.length) return fallback;
  return Math.min(...prices.map((price) => price[key]));
}

function formatPrice(value: number, stock: Stock) {
  return isJpyStock(stock) ? `¥${Math.round(value).toLocaleString()}` : `$${value.toFixed(2)}`;
}

function isJpyStock(stock: Stock) {
  return stock.ticker.endsWith(".T") || stock.exchange.toUpperCase().includes("TSE");
}

function toneText(tone: "default" | "up" | "down" | "warn") {
  return {
    default: "text-slate-100",
    up: "text-sky-300",
    down: "text-red-300",
    warn: "text-yellow-300"
  }[tone];
}

function sentimentClass(tone: "default" | "up" | "down") {
  return {
    default: "border-slate-400/30 bg-slate-400/10 text-slate-300",
    up: "border-sky-300/40 bg-sky-300/15 text-sky-200",
    down: "border-red-400/40 bg-red-400/15 text-red-200"
  }[tone];
}
