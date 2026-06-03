"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { SpotEntrySimulator } from "@/components/SpotEntrySimulator";
import { StockDecisionPanel } from "@/components/StockDecisionPanel";
import { StockChart } from "@/components/StockChart";
import { resolvePriceSeries } from "@/lib/indicators";
import { analyzePatternSimilarity } from "@/lib/pattern-similarity";
import { getPricesForTicker, news as localNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { DailyPrice, NewsItem, Stock, WatchStatus, WatchlistItem } from "@/types";

type HistoryApiResult = {
  ok: true;
  stock: Stock;
  prices: DailyPrice[];
  price: DailyPrice;
  news: NewsItem[];
  score: number;
  status: WatchStatus;
  mode: "live" | "mock";
  provider: "yahoo" | "alpha_vantage" | "saved" | "local";
  sourceLabel: string;
  warning?: string;
  fetchedAt: string;
};

const emptyDailyPrices: DailyPrice[] = [];

export default function StockDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const normalizedTicker = normalizeTicker(ticker);
  const jobResult = useAiJobResult();
  const userWatchlist = useUserWatchlist();
  const [historyData, setHistoryData] = useState<HistoryApiResult | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "done" | "error">("loading");
  const [historyError, setHistoryError] = useState("");

  const watchItem = userWatchlist.items.find((row) => row.stock.ticker === normalizedTicker)
    ?? watchlist.find((row) => row.stock.ticker === normalizedTicker)
    ?? null;
  const activeHistoryData = historyData?.stock.ticker === normalizedTicker ? historyData : null;
  const stock = watchItem?.stock ?? activeHistoryData?.stock ?? buildFallbackStock(normalizedTicker);
  const localPrices = getPricesForTicker(stock.ticker);
  const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === stock.ticker);
  const livePrice = live?.price ?? (stock.ticker === "RGTI" ? jobResult?.price : null) ?? activeHistoryData?.price ?? null;
  const basePrices = localPrices ?? activeHistoryData?.prices ?? live?.prices ?? (watchItem ? [latestPriceFromWatchItem(watchItem)] : []);
  const resolvedPrices = basePrices.length ? resolvePriceSeries(basePrices, live?.prices ?? activeHistoryData?.prices, livePrice) : null;
  const mergedPrices = resolvedPrices?.prices ?? emptyDailyPrices;
  const latest = mergedPrices.at(-1);
  const latestPriceText = latest ? formatStockPrice(latest.close, stock) : "-";
  const tickerNews = live?.news?.length
    ? live.news
    : activeHistoryData?.news?.length
      ? activeHistoryData.news
      : localNews.filter((newsItem) => newsItem.ticker === stock.ticker);
  const sourceLabel = live
    ? resolvedPrices?.source ?? "AI Job"
    : activeHistoryData?.sourceLabel ?? (localPrices ? "Local verified history" : "Loading");
  const detailItems = userWatchlist.items.length ? userWatchlist.items : watchlist;
  const isWatchlistFallbackOnly = Boolean(watchItem && !localPrices && !activeHistoryData?.prices?.length && !live?.prices?.length);
  const chartPrices = mergedPrices;
  const tablePrices = mergedPrices.slice().reverse();
  const scoreAnalysis = latest ? analyzeStock(latest, tickerNews) : null;
  const decisionLevels = useMemo(() => mergedPrices.length ? buildDecisionLevels(mergedPrices) : null, [mergedPrices]);
  const patternSimilarity = useMemo(() => mergedPrices.length ? analyzePatternSimilarity(mergedPrices) : null, [mergedPrices]);
  const newsCounts = {
    positive: tickerNews.filter((newsItem) => newsItem.sentiment === "Positive").length,
    neutral: tickerNews.filter((newsItem) => newsItem.sentiment === "Neutral").length,
    negative: tickerNews.filter((newsItem) => newsItem.sentiment === "Negative").length
  };

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      setHistoryStatus("loading");
      setHistoryError("");
      try {
        const response = await fetch(`/api/stocks/${encodeURIComponent(normalizedTicker)}/history`, { cache: "no-store" });
        const data = await response.json() as HistoryApiResult | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !data.ok) {
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError("error" in data ? data.error ?? "株価履歴を取得できませんでした。" : "株価履歴を取得できませんでした。");
          return;
        }
        setHistoryData(data);
        setHistoryStatus("done");
      } catch (error) {
        if (!cancelled) {
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError(error instanceof Error ? error.message : "株価履歴を取得できませんでした。");
        }
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [normalizedTicker]);

  if (!latest || !mergedPrices.length || !scoreAnalysis || !decisionLevels || !patternSimilarity) {
    return (
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Stock Detail</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">{stock.ticker}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {historyStatus === "error" ? historyError : "株価履歴を取得中です。"}
        </p>
        <Link className="mt-4 inline-flex rounded-xl border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-sm font-bold text-sky-100" href="/watchlist">
          Watchlistに戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/25 ring-1 ring-white/5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Stock Detail</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50 sm:text-4xl">{stock.ticker}</h2>
            <p className="mt-2 text-sm text-slate-400">{stock.companyName} / {stock.exchange}</p>
          </div>
          <div className="grid min-w-0 gap-2 text-left sm:grid-cols-2 sm:text-right lg:grid-cols-1">
            <div className={latest.changePercent >= 0 ? "text-sky-300" : "text-red-300"}>
              <p className="text-3xl font-black">{latestPriceText}</p>
              <p className="text-sm font-bold">{latest.changePercent >= 0 ? "+" : ""}{latest.changePercent.toFixed(2)}%</p>
            </div>
            <div className="break-words rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
              Source: {sourceLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <span className="px-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Select Stock</span>
        {detailItems.map((row) => {
          const active = row.stock.ticker === stock.ticker;
          return (
            <Link
              key={row.stock.ticker}
              href={`/stocks/${row.stock.ticker}`}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                active
                  ? "border-sky-300/50 bg-sky-300/15 text-sky-100 shadow-lg shadow-sky-950/30"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-sky-300/30 hover:bg-sky-300/10"
              }`}
            >
              {row.stock.ticker}
            </Link>
          );
        })}
      </div>
      {live?.error || jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {live?.error ?? jobResult?.error}
        </div>
      ) : null}
      {live?.warning || activeHistoryData?.warning ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Warning: {live?.warning ?? activeHistoryData?.warning}
        </div>
      ) : null}
      {isWatchlistFallbackOnly ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Data Notice: {stock.ticker}はWatchlistに保存された最新価格で暫定表示しています。履歴取得が成功すると、チャート・過去データ・AI診断は取得済みの日足データに自動で切り替わります。
          {historyStatus === "error" ? ` ${historyError}` : ""}
        </div>
      ) : null}
      {resolvedPrices?.rejectedLive ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Data Warning: APIから取得した{stock.ticker}価格がローカル検証済み履歴と大きく異なるため、テーブルとチャートではローカル履歴を優先表示しています。
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <InsightCard label="最新終値" value={latestPriceText} />
        <InsightCard label="前日比" value={`${latest.changePercent.toFixed(2)}%`} tone={latest.changePercent >= 0 ? "up" : "down"} />
        <InsightCard label="RSI" value={latest.rsi.toFixed(2)} tone={latest.rsi >= 70 ? "warn" : latest.rsi >= 55 ? "up" : "default"} />
        <InsightCard label="日次データ件数" value={`${mergedPrices.length}件`} tone="blue" />
      </section>

      <DecisionSectionNav />

      <section id="conclusion" className="scroll-mt-24 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <SectionHeading title="結論" note="最初に見るべき投資判断の要約" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DecisionTile label="現在の姿勢" value={buildPostureLabel(latest, scoreAnalysis.score, decisionLevels.support, newsCounts.negative)} tone={scoreAnalysis.score >= 6 ? "up" : newsCounts.negative ? "warn" : "default"} />
          <DecisionTile label="短期レンジ" value={`${formatStockPrice(decisionLevels.support, stock)} - ${formatStockPrice(decisionLevels.resistance, stock)}`} />
          <DecisionTile label="上昇確認" value={`${formatStockPrice(decisionLevels.breakout, stock)} 突破`} tone="up" />
          <DecisionTile label="危険ライン" value={`${formatStockPrice(decisionLevels.danger, stock)} 割れ`} tone="down" />
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-200">
          {stock.ticker}は、まず{formatStockPrice(decisionLevels.support, stock)}〜{formatStockPrice(decisionLevels.resistance, stock)}の価格帯を基準に見ます。
          上方向は{formatStockPrice(decisionLevels.breakout, stock)}を出来高を伴って維持できるか、下方向は{formatStockPrice(decisionLevels.danger, stock)}を明確に割らないかが重要です。
          ニュースはPositive {newsCounts.positive}件、Neutral {newsCounts.neutral}件、Negative {newsCounts.negative}件です。
        </p>
      </section>

      <section id="upside" className="scroll-mt-24">
        <SectionHeading title="上昇条件" note="上に行くために確認したい価格・出来高・トレンド条件" />
        <StockDecisionPanel
          stock={stock}
          prices={mergedPrices}
          news={tickerNews}
          analysis={scoreAnalysis}
          sourceLabel={sourceLabel}
        />
      </section>

      <section id="danger" className="scroll-mt-24 rounded-2xl border border-red-300/20 bg-red-300/[0.06] p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <SectionHeading title="危険ライン" note="前提が崩れる水準と、深い調整に変わる条件" />
        <div className="grid gap-3 md:grid-cols-3">
          <DecisionTile label="危険ライン" value={formatStockPrice(decisionLevels.danger, stock)} tone="down" />
          <DecisionTile label="MA20" value={formatStockPrice(latest.ma20, stock)} />
          <DecisionTile label="MA50" value={formatStockPrice(latest.ma50, stock)} />
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-200">
          {formatStockPrice(decisionLevels.danger, stock)}を出来高増で割る場合、短期レンジの下抜けだけでなく、損切り・資金管理を優先する局面になります。
          特にRSIが弱まり、MA20とMA50を同時に下回る場合は、反発狙いよりも下値確認を優先します。
        </p>
      </section>

      <section className="min-w-0 scroll-mt-24" id="chart">
        <SectionHeading title="チャート" note="価格推移とテクニカルの全体像" />
        <StockChart prices={chartPrices} ticker={stock.ticker} />
      </section>

      <section id="simulation" className="scroll-mt-24">
        <SectionHeading title="現物シミュレーション" note="現在付近で入った場合の利確・損切り・税金・為替影響" />
        <SpotEntrySimulator stock={stock} price={latest} news={tickerNews} score={scoreAnalysis.score} />
      </section>

      <section id="news-materials" className="scroll-mt-24 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <SectionHeading title="ニュース材料" note="AIスコアに影響している強材料と注意材料" />
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="mt-2 text-sm leading-6 text-slate-300">{scoreAnalysis.summary}</p>
          </div>
          <div className="rounded-2xl border border-sky-300/25 bg-sky-300/10 px-4 py-3">
            <p className="text-xs font-semibold text-sky-200">Advanced Score</p>
            <p className="mt-1 text-3xl font-black text-sky-100">{scoreAnalysis.score}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ReasonList title="強材料" items={scoreAnalysis.positivePoints.slice(0, 4)} />
          <ReasonList title="注意材料" items={scoreAnalysis.negativePoints.slice(0, 4)} />
        </div>
      </section>

      <section id="similar-patterns" className="scroll-mt-24 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <SectionHeading title="過去類似" note="今の形に近い過去パターンと、その後の値動き" />
        <div className="grid gap-3 md:grid-cols-3">
          {patternSimilarity.horizons.map((horizon) => (
            <DecisionTile
              key={horizon.days}
              label={`${horizon.days}営業日後`}
              value={`${horizon.averageReturn >= 0 ? "+" : ""}${horizon.averageReturn.toFixed(2)}%`}
              sub={`上昇確率 ${horizon.winRate.toFixed(0)}% / ${horizon.sampleCount}件`}
              tone={horizon.averageReturn > 0 ? "up" : horizon.averageReturn < 0 ? "down" : "default"}
            />
          ))}
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-200">{patternSimilarity.summary}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{patternSimilarity.caveat}</p>
      </section>

      <section className="md:hidden">
        <div className="mb-3">
          <h3 className="text-base font-bold text-slate-50">日次データ</h3>
          <p className="mt-1 text-xs text-slate-500">スマホでは直近14営業日をカードで表示します。</p>
        </div>
        <div className="space-y-3">
          {tablePrices.slice(0, 14).map((price) => <MobileDailyCard key={price.date} price={price} stock={stock} />)}
        </div>
      </section>

      <div className="hidden md:block">
        <DataTable
          headers={["日付", "始値", "高値", "安値", "終値", "出来高", "前日比%", "出来高倍率", "RSI", "MACD", "MACD方向", "MA5", "MA20", "MA50", "スコア", "判定"]}
          rows={tablePrices.map((price) => [
            price.date,
            formatStockPrice(price.open, stock),
            formatStockPrice(price.high, stock),
            formatStockPrice(price.low, stock),
            formatStockPrice(price.close, stock),
            `${Math.round(price.volume / 1000000)}M`,
            <ChangeCell key="change" value={price.changePercent} />,
            <VolumeRatioCell key="volume-ratio" value={price.volumeRatio} />,
            <RsiCell key="rsi" value={price.rsi} />,
            price.macd.toFixed(2),
            <DirectionCell key="macd-direction" value={price.macdDirection} />,
            formatStockPrice(price.ma5, stock),
            formatStockPrice(price.ma20, stock),
            formatStockPrice(price.ma50, stock),
            <ScoreCell key="score" value={price.score} />,
            <PatternCell key="pattern" pattern={price.pattern} score={price.score} high20Breakout={price.high20Breakout} />
          ])}
        />
      </div>
    </div>
  );
}

function DecisionSectionNav() {
  const links = [
    ["#conclusion", "結論"],
    ["#upside", "上昇条件"],
    ["#danger", "危険ライン"],
    ["#news-materials", "ニュース材料"],
    ["#similar-patterns", "過去類似"],
    ["#simulation", "現物シミュレーション"]
  ] as const;

  return (
    <nav className="sticky top-16 z-20 -mx-1 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-2 shadow-xl shadow-black/25 backdrop-blur [-webkit-overflow-scrolling:touch]">
      <div className="flex min-w-max gap-2">
        {links.map(([href, label]) => (
          <a key={href} href={href} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-slate-300 transition hover:border-sky-300/35 hover:bg-sky-300/10 hover:text-sky-100 sm:px-4 sm:text-sm">
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-black text-slate-50">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function DecisionTile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "up" | "down" | "warn" }) {
  const color = {
    default: "text-slate-50",
    up: "text-sky-300",
    down: "text-red-300",
    warn: "text-yellow-300"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-2 break-words text-xl font-black ${color}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs leading-5 text-slate-500">{sub}</p> : null}
    </div>
  );
}

function buildDecisionLevels(prices: DailyPrice[]) {
  const latest = prices[prices.length - 1];
  const recent20 = prices.slice(-20);
  const recent60 = prices.slice(-60);
  const low20 = Math.min(...recent20.map((price) => price.low));
  const high20 = Math.max(...recent20.map((price) => price.high));
  const high60 = Math.max(...recent60.map((price) => price.high));
  const support = Math.min(low20, latest.ma20 || low20);
  return {
    support,
    resistance: high20,
    breakout: Math.max(high20, latest.ma20 || high20),
    danger: Math.min(support, latest.ma50 || support),
    high60
  };
}

function buildPostureLabel(latest: DailyPrice, score: number, support: number, negativeNews: number) {
  if (latest.close < support || negativeNews >= 2) return "警戒";
  if (score >= 6 && latest.close >= latest.ma20) return "継続監視";
  if (latest.rsi >= 70) return "過熱注意";
  return "様子見";
}

function normalizeTicker(ticker: string) {
  const normalized = ticker.trim().toUpperCase();
  if (/^\d{4}$/.test(normalized)) return `${normalized}.T`;
  if (/^\d{4}\.JP$/i.test(normalized)) return normalized.replace(/\.JP$/i, ".T");
  return normalized;
}

function buildFallbackStock(ticker: string): Stock {
  const isJapan = isJpyStockTicker(ticker);
  return {
    ticker,
    companyName: ticker,
    sector: isJapan ? "Japan Equity" : "US Equity",
    exchange: isJapan ? "TSE" : "NASDAQ/NYSE"
  };
}

function latestPriceFromWatchItem(item: WatchlistItem): DailyPrice {
  const currentPrice = item.currentPrice > 0 ? item.currentPrice : item.previousClose;
  const previousClose = item.previousClose > 0 ? item.previousClose : currentPrice;
  const changePercent = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
  return {
    date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }),
    open: previousClose,
    high: Math.max(currentPrice, previousClose),
    low: Math.min(currentPrice, previousClose),
    close: currentPrice,
    volume: 0,
    changePercent,
    volumeAverage20: 0,
    volumeRatio: 0,
    intradayRangePercent: previousClose > 0 ? ((Math.max(currentPrice, previousClose) - Math.min(currentPrice, previousClose)) / previousClose) * 100 : 0,
    rsi: 50,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    macdDirection: changePercent >= 0 ? "上昇" : "低下",
    rsiSignal: "Neutral",
    high20Breakout: "",
    ma5: currentPrice,
    ma20: currentPrice,
    ma50: currentPrice,
    volumeAverage: 0,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score: 4,
    pattern: "Watchlist latest price",
    comment: "Watchlistに保存された最新価格から生成した暫定データです。",
    source: "Watchlist saved quote"
  };
}

function formatStockPrice(value: number, stock: Stock) {
  if (!Number.isFinite(value)) return "-";
  if (isJpyStock(stock)) return `¥${Math.round(value).toLocaleString("ja-JP")}`;
  return `$${value.toFixed(2)}`;
}

function isJpyStock(stock: Stock) {
  return isJpyStockTicker(stock.ticker) || stock.exchange === "TSE";
}

function isJpyStockTicker(ticker: string) {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker);
}

function ReasonList({ title, items }: { title: string; items: { label: string; points: number; detail: string }[] }) {
  return (
    <div className="rounded-xl bg-slate-950/55 p-3">
      <p className="text-sm font-bold text-slate-100">{title}</p>
      <div className="mt-3 space-y-3">
        {items.length ? items.map((item) => (
          <div key={item.label} className="border-t border-white/10 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-200">{item.label}</span>
              <span className={item.points > 0 ? "text-sm font-bold text-green-300" : "text-sm font-bold text-red-300"}>
                {item.points > 0 ? "+" : ""}{item.points}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
          </div>
        )) : <p className="text-sm text-slate-500">該当なし</p>}
      </div>
    </div>
  );
}

function MobileDailyCard({ price, stock }: { price: DailyPrice; stock: Stock }) {
  const isUp = price.changePercent >= 0;

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-lg shadow-black/20 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-50">{price.date}</p>
          <p className="mt-1 text-xs text-slate-500">出来高 {Math.round(price.volume / 1000000).toLocaleString()}M</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-black text-slate-50">{formatStockPrice(price.close, stock)}</p>
          <p className={isUp ? "mt-1 text-sm font-bold text-sky-300" : "mt-1 text-sm font-bold text-red-300"}>
            {isUp ? "+" : ""}{price.changePercent.toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <MobileMetric label="始値" value={formatStockPrice(price.open, stock)} />
        <MobileMetric label="高値" value={formatStockPrice(price.high, stock)} />
        <MobileMetric label="安値" value={formatStockPrice(price.low, stock)} />
        <MobileMetric label="RSI" value={price.rsi.toFixed(2)} tone={price.rsi >= 70 ? "warn" : price.rsi >= 55 ? "up" : "default"} />
        <MobileMetric label="MA20" value={formatStockPrice(price.ma20, stock)} />
        <MobileMetric label="出来高倍率" value={`${price.volumeRatio.toFixed(2)}x`} tone={price.volumeRatio >= 1.2 ? "up" : "default"} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <DirectionCell value={price.macdDirection} />
        <ScoreCell value={price.score} />
        <PatternCell pattern={price.pattern} score={price.score} high20Breakout={price.high20Breakout} />
      </div>
    </article>
  );
}

function MobileMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "warn" }) {
  const color = {
    default: "text-slate-100",
    up: "text-sky-300",
    warn: "text-yellow-300"
  }[tone];

  return (
    <div className="rounded-xl bg-slate-950/55 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function InsightCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "warn" | "blue" }) {
  const color = {
    default: "text-slate-50",
    up: "text-sky-300",
    down: "text-red-300",
    warn: "text-yellow-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-3 text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex min-w-20 justify-center rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>{children}</span>;
}

function ChangeCell({ value }: { value: number }) {
  if (value > 0) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">+{value.toFixed(2)}%</Pill>;
  if (value < 0) return <Pill className="border-red-400/40 bg-red-400/15 text-red-300">{value.toFixed(2)}%</Pill>;
  return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">0.00%</Pill>;
}

function VolumeRatioCell({ value }: { value: number }) {
  if (value >= 1.5) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{value.toFixed(2)}x</Pill>;
  if (value >= 1.2) return <Pill className="border-green-400/40 bg-green-400/15 text-green-300">{value.toFixed(2)}x</Pill>;
  if (value > 0) return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">{value.toFixed(2)}x</Pill>;
  return <span className="text-slate-500">-</span>;
}

function RsiCell({ value }: { value: number }) {
  if (value >= 70) return <Pill className="border-yellow-300/40 bg-yellow-300/15 text-yellow-200">{value.toFixed(2)}</Pill>;
  if (value >= 55) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{value.toFixed(2)}</Pill>;
  if (value > 0) return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">{value.toFixed(2)}</Pill>;
  return <span className="text-slate-500">-</span>;
}

function DirectionCell({ value }: { value: "上昇" | "低下" }) {
  return value === "上昇"
    ? <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">上昇</Pill>
    : <Pill className="border-red-400/40 bg-red-400/15 text-red-300">低下</Pill>;
}

function ScoreCell({ value }: { value: number }) {
  if (value >= 8) return <Pill className="border-green-400/40 bg-green-400/15 text-green-300">{value}</Pill>;
  if (value >= 6) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{value}</Pill>;
  if (value >= 4) return <Pill className="border-yellow-300/40 bg-yellow-300/15 text-yellow-200">{value}</Pill>;
  return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">{value}</Pill>;
}

function PatternCell({ pattern, score, high20Breakout }: { pattern: string; score: number; high20Breakout: string }) {
  const label = pattern || high20Breakout || (score >= 6 ? "類似上昇候補" : "通常");
  if (score >= 8 || pattern.includes("強気") || high20Breakout) {
    return <Pill className="border-green-400/40 bg-green-400/15 text-green-300">{label}</Pill>;
  }
  if (score >= 6 || pattern.includes("候補")) {
    return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{label}</Pill>;
  }
  if (score >= 4) {
    return <Pill className="border-yellow-300/40 bg-yellow-300/15 text-yellow-200">{label}</Pill>;
  }
  return <span className="text-slate-500">{label}</span>;
}
