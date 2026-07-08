"use client";

import { use, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { DataQualityPanel, freshnessTone, type DataQualityItem } from "@/components/DataQualityPanel";
import { LargeMoneyFlowPanel } from "@/components/LargeMoneyFlowPanel";
import { MarketBadge, MarketFilterButton, countWatchlistLists, filterItemsByWatchlistList, marketForStock, marketForWatchItem } from "@/components/MarketControls";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { ScoreGauge } from "@/components/ScoreGauge";
import { PriceAlertPanel } from "@/components/PriceAlertPanel";
import { SpotEntrySimulator } from "@/components/SpotEntrySimulator";
import { ShortSellingPanel } from "@/components/ShortSellingPanel";
import { StockDecisionPanel } from "@/components/StockDecisionPanel";
import { StockChart } from "@/components/StockChart";
import { mergeRealtimeDailyPrice, resolvePriceSeries, validateDailyPriceSeries } from "@/lib/indicators";
import { analyzePatternSimilarity, type PatternHorizon } from "@/lib/pattern-similarity";
import { getPricesForTicker, news as localNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { useCountUp } from "@/lib/use-count-up";
import { useShortSellingData } from "@/lib/use-short-selling-data";
import { useStockLiveData } from "@/lib/use-stock-live-data";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import { useAutoNewsFeed } from "@/lib/use-auto-news-feed";
import { latestNewsDate, mergeNewsSources, newsForTicker, resolveNewsQualitySource } from "@/lib/news-feed";
import { useWatchlistLists } from "@/lib/watchlist-lists";
import { resolveVisibleWatchlist } from "@/lib/watchlist-display";
import { useUserWatchlist } from "@/lib/user-watchlist";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import type { DailyPrice, Stock, WatchlistItem } from "@/types";

const emptyDailyPrices: DailyPrice[] = [];
const baseDecisionNavItems = [
  { id: "conclusion", label: "結論" },
  { id: "upside", label: "上昇条件" },
  { id: "danger", label: "危険ライン" },
  { id: "news-materials", label: "ニュース" },
  { id: "similar-patterns", label: "類似パターン" },
  { id: "simulation", label: "シミュレーション" }
] as const;

type DecisionSectionId = typeof baseDecisionNavItems[number]["id"] | "short-selling";

export default function StockDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const normalizedTicker = normalizeTicker(ticker);
  const jobResult = useAiJobResult();
  const listManager = useWatchlistLists();
  const userWatchlist = useUserWatchlist();
  const seededHistory = userWatchlist.getTickerHistory(normalizedTicker);
  const { historyData, historyStatus, historyError, realtimeQuote } = useStockLiveData(normalizedTicker, {
    historyRevision: userWatchlist.historyRevision,
    seededHistory
  });
  const [activeSection, setActiveSection] = useState<DecisionSectionId>("conclusion");
  const [detailListId, setDetailListId] = useState("all");

  const customWatchItem = userWatchlist.items.find((row) => row.stock.ticker === normalizedTicker) ?? null;
  const watchItem = customWatchItem ?? watchlist.find((row) => row.stock.ticker === normalizedTicker) ?? null;
  const activeHistoryData = historyData?.stock.ticker === normalizedTicker ? historyData : null;
  const stock = watchItem?.stock ?? activeHistoryData?.stock ?? buildFallbackStock(normalizedTicker);
  const isJapanStock = isJpyStock(stock);
  const decisionNavItems = useMemo<Array<{ id: DecisionSectionId; label: string }>>(() => {
    const items: Array<{ id: DecisionSectionId; label: string }> = [...baseDecisionNavItems];
    if (isJapanStock) {
      items.splice(3, 0, { id: "short-selling", label: "空売り公表" });
    }
    return items;
  }, [isJapanStock]);
  const shortSellingState = useShortSellingData(stock.ticker, isJapanStock);
  const localPrices = getPricesForTicker(stock.ticker);
  const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === stock.ticker);
  const livePrice = live?.price
    ?? (stock.ticker === "RGTI" ? jobResult?.price : null)
    ?? activeHistoryData?.price
    ?? customWatchItem?.latestPrice
    ?? null;
  const cachedHistory = userWatchlist.getTickerHistory(stock.ticker);
  const basePrices = activeHistoryData?.prices ?? cachedHistory?.prices ?? customWatchItem?.priceHistory ?? localPrices ?? live?.prices ?? (watchItem ? [latestPriceFromWatchItem(watchItem)] : []);
  const resolvedPrices = basePrices.length ? resolvePriceSeries(basePrices, live?.prices ?? activeHistoryData?.prices, livePrice) : null;
  const rawMergedPrices = mergeRealtimeDailyPrice(resolvedPrices?.prices ?? emptyDailyPrices, realtimeQuote, stock.ticker);
  const priceValidation = validateDailyPriceSeries(rawMergedPrices, stock.ticker);
  const mergedPrices = priceValidation.prices;
  const latest = mergedPrices.at(-1);
  const displayClose = realtimeQuote?.regular.price ?? latest?.close;
  const displayChangePercent = realtimeQuote?.regular.changePercent ?? latest?.changePercent ?? 0;
  const latestPriceText = displayClose ? formatStockPrice(displayClose, stock) : "-";
  const regularPreviousClose = realtimeQuote?.regular.previousClose ?? mergedPrices[mergedPrices.length - 2]?.close ?? watchItem?.previousClose ?? null;
  const detailItems = resolveVisibleWatchlist(userWatchlist.items);
  const detailTickers = useMemo(() => detailItems.map((item) => item.stock.ticker), [detailItems]);
  const autoNewsFeed = useAutoNewsFeed(detailTickers, stock.ticker);
  const tickerNews = mergeNewsSources(
    live?.news ?? [],
    newsForTicker(autoNewsFeed.news, stock.ticker),
    activeHistoryData?.news ?? [],
    localNews.filter((newsItem) => newsItem.ticker === stock.ticker)
  );
  const sourceLabel = realtimeQuote
    ? `${realtimeQuote.source} / live`
    : live
      ? resolvedPrices?.source ?? "AI Job"
      : activeHistoryData?.sourceLabel ?? (localPrices ? "Local verified history" : "Loading");
  const detailListCounts = useMemo(() => countWatchlistLists(listManager.lists, detailItems), [detailItems, listManager.lists]);
  const marketFilteredDetailItems = useMemo(
    () => filterItemsByWatchlistList(detailItems, detailListId),
    [detailItems, detailListId]
  );
  const isWatchlistFallbackOnly = Boolean(watchItem && !localPrices && !activeHistoryData?.prices?.length && !live?.prices?.length);
  const chartPrices = mergedPrices;
  const tablePrices = mergedPrices.slice().reverse();
  const scoreAnalysis = latest ? analyzeStock(latest, tickerNews) : null;
  const animDetailScore = useCountUp(scoreAnalysis?.score ?? 0, 900);
  const decisionLevels = useMemo(() => mergedPrices.length ? buildDecisionLevels(mergedPrices) : null, [mergedPrices]);
  const patternSimilarity = useMemo(() => mergedPrices.length ? analyzePatternSimilarity(mergedPrices) : null, [mergedPrices]);
  const newsCounts = {
    positive: tickerNews.filter((newsItem) => newsItem.sentiment === "Positive").length,
    neutral: tickerNews.filter((newsItem) => newsItem.sentiment === "Neutral").length,
    negative: tickerNews.filter((newsItem) => newsItem.sentiment === "Negative").length
  };
  const dataQualityItems: DataQualityItem[] = [
    {
      label: "Realtime",
      source: realtimeQuote?.source ?? "未取得",
      asOf: realtimeQuote?.regular.asOf ?? realtimeQuote?.fetchedAt,
      tone: realtimeQuote ? freshnessTone(realtimeQuote.regular.asOf, 20, 120) : "fallback",
      detail: "表示価格とリアルタイム日次反映に使用します。"
    },
    {
      label: "Daily History",
      source: sourceLabel,
      asOf: activeHistoryData?.fetchedAt ?? latest?.date,
      tone: isWatchlistFallbackOnly || resolvedPrices?.rejectedLive || priceValidation.issues.length ? "warning" : activeHistoryData ? freshnessTone(activeHistoryData.fetchedAt, 24 * 60, 7 * 24 * 60) : "fallback",
      detail: "チャート、テクニカル、判断パネルの計算元です。"
    },
    {
      label: "News",
      source: resolveNewsQualitySource({
        autoFeedSource: autoNewsFeed.source,
        hasAiJobNews: Boolean(live?.news?.length),
        hasHistoryNews: Boolean(activeHistoryData?.news?.length)
      }),
      asOf: autoNewsFeed.fetchedAt ?? latestNewsDate(tickerNews) ?? null,
      tone: tickerNews.length
        ? freshnessTone(autoNewsFeed.fetchedAt ?? latestNewsDate(tickerNews), 60, 24 * 60)
        : "fallback",
      detail: `${tickerNews.length}件。SEC/TDnet/NewsAPIを5分ごとに自動取得。AI Job未実行でも更新されます。`
    },
    {
      label: "AI Analysis",
      source: live ? "AI Job result" : jobResult ? "AI Job partial" : "未実行",
      asOf: jobResult?.lastRun,
      tone: live?.error || jobResult?.error ? "error" : live?.warning || activeHistoryData?.warning ? "warning" : jobResult ? "fresh" : "fallback",
      detail: "AIコメントは投資助言ではなく、価格・ニュース・履歴に基づく参考情報です。"
    }
  ];
  const dataQualityWarnings = [
    live?.error ?? jobResult?.error ?? "",
    live?.warning ?? activeHistoryData?.warning ?? "",
    isWatchlistFallbackOnly ? `${stock.ticker}はWatchlist保存価格で暫定表示しています。` : "",
    resolvedPrices?.rejectedLive ? `API価格が検証済み履歴と大きく異なるため、${stock.ticker}はローカル履歴を優先表示しています。` : "",
    priceValidation.issues[0]?.message ?? "",
    autoNewsFeed.warning ? `News auto-feed: ${autoNewsFeed.warning}` : ""
  ];

  useEffect(() => {
    const sections = decisionNavItems
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => Boolean(section));

    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visibleEntry?.target.id) {
          setActiveSection(visibleEntry.target.id as DecisionSectionId);
        }
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5, 0.75]
      }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [stock.ticker]);

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
      <LiveWatchlistStrip />
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/25 ring-1 ring-white/5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Stock Detail</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <h2 className="text-3xl font-black tracking-tight text-slate-50 sm:text-4xl">{stock.ticker}</h2>
              <ScoreGauge score={animDetailScore} maxScore={100} size={80} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <MarketBadge market={marketForStock(stock)} />
              <span>{stock.companyName} / {stock.exchange}</span>
            </div>
            {/* キーメトリクスピル */}
            <div className="mt-3 flex flex-wrap gap-2">
              <MetricPill label="RSI" value={latest.rsi.toFixed(0)} tone={latest.rsi >= 70 ? "red" : latest.rsi <= 35 ? "green" : "neutral"} />
              <MetricPill label="MACD" value={latest.macdDirection} tone={latest.macdDirection === "上昇" ? "green" : "red"} />
              <MetricPill label="出来高比" value={`${latest.volumeRatio.toFixed(1)}x`} tone={latest.volumeRatio >= 1.5 ? "green" : latest.volumeRatio < 0.7 ? "red" : "neutral"} />
              {latest.high20Breakout && (
                <MetricPill label="🚀" value={latest.high20Breakout} tone="green" />
              )}
            </div>
          </div>
          <div className="grid min-w-0 gap-2 text-left sm:grid-cols-2 sm:text-right lg:grid-cols-1">
            <div className={displayChangePercent >= 0 ? "text-sky-300" : "text-red-300"}>
              <p className="text-3xl font-black">{latestPriceText}</p>
              <p className="text-sm font-bold">{displayChangePercent >= 0 ? "+" : ""}{displayChangePercent.toFixed(2)}%</p>
              {regularPreviousClose && (
                <p className="mt-0.5 text-xs text-slate-500">前日終値 {formatStockPrice(regularPreviousClose, stock)}</p>
              )}
            </div>
            <div className="break-words rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
              Source: {sourceLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <span className="px-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Select Stock</span>
        {listManager.lists.map((list) => (
          <MarketFilterButton key={list.id} active={detailListId === list.id} count={detailListCounts[list.id] ?? 0} label={list.name} onClick={() => setDetailListId(list.id)} />
        ))}
        {marketFilteredDetailItems.map((row) => {
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
              <span className="inline-flex items-center gap-2">
                <span>{row.stock.ticker}</span>
                <MarketBadge market={marketForWatchItem(row)} compact />
              </span>
            </Link>
          );
        })}
        {marketFilteredDetailItems.length === 0 ? (
          <span className="px-2 text-xs font-semibold text-slate-500">この市場のWatchlist銘柄はまだありません。</span>
        ) : null}
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
      {priceValidation.issues.length ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Data Quality Warning: 日足データを検証し、確認が必要な品質項目を{priceValidation.issues.length}件検出しました。
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {priceValidation.issues.slice(0, 3).map((issue, index) => (
              <li key={`${issue.code}-${issue.date ?? index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <DataQualityPanel title="データ鮮度" items={dataQualityItems} warnings={dataQualityWarnings} />

      <section className="grid gap-4 md:grid-cols-4">
        <InsightCard label="最新終値" value={latestPriceText} />
        <InsightCard label="前日比" value={`${latest.changePercent.toFixed(2)}%`} tone={latest.changePercent >= 0 ? "up" : "down"} />
        <InsightCard label="RSI" value={latest.rsi.toFixed(2)} tone={latest.rsi >= 70 ? "warn" : latest.rsi >= 55 ? "up" : "default"} />
        <InsightCard label="日次データ件数" value={`${mergedPrices.length}件`} tone="blue" />
      </section>

      <DecisionSectionNav activeSection={activeSection} items={decisionNavItems} />

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

      <LargeMoneyFlowPanel prices={mergedPrices} news={tickerNews} />

      <section id="upside" className="scroll-mt-24">
        <SectionHeading title="上昇条件" note="上に行くために確認したい価格・出来高・トレンド条件" />
        <StockDecisionPanel
          stock={stock}
          prices={mergedPrices}
          news={tickerNews}
          analysis={scoreAnalysis}
          sourceLabel={sourceLabel}
          newsFeedSource={autoNewsFeed.source}
          newsFeedFetchedAt={autoNewsFeed.fetchedAt}
          newsFeedWarning={autoNewsFeed.warning}
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

      <section className="min-w-0 scroll-mt-24 overflow-x-hidden" id="chart">
        <SectionHeading title="チャート" note="価格推移とテクニカルの全体像" />
        <StockChart
          prices={chartPrices}
          ticker={stock.ticker}
          intraday={realtimeQuote?.intraday ?? []}
          intradayCandles={realtimeQuote?.intradayCandles ?? []}
          previousClose={regularPreviousClose}
        />
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
        <div className="mt-4">
          <ScoreBreakdown factors={scoreAnalysis.factors} score={scoreAnalysis.score} status={scoreAnalysis.status} />
        </div>
      </section>

      {isJapanStock ? (
        <section id="short-selling" className="scroll-mt-24 rounded-2xl border border-red-300/20 bg-red-300/[0.06] p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
          <SectionHeading title="空売り残高報告" note="JPX公表と同等。残高割合0.5%以上の空売り残高報告を表示します" />
          <ShortSellingPanel
            data={shortSellingState.data}
            error={shortSellingState.error}
            status={shortSellingState.status}
          />
        </section>
      ) : null}

      <ProCtaBar
        title={`過去類似パターン分析（${patternSimilarity.sampleCount}件）`}
        description="似た値動きから、5日・10日・20日後の傾向を比較できます"
        buttonLabel="Pro で見る →"
      />
      <section id="similar-patterns" className="scroll-mt-24 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <SectionHeading title="過去類似" note="今の形に近い過去パターンと、その後の値動き" />
        <div className="grid grid-cols-3 gap-2">
          {patternSimilarity.horizons.map((horizon) => (
            <SimilarPatternCard key={horizon.days} horizon={horizon} />
          ))}
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-200">{patternSimilarity.summary}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">過去パターンは参考値です。ニュース・決算・地合いで結果は変わります</p>
      </section>

      <ProCtaBar
        title="AI詳細診断・質問機能"
        description="現在地のデータをもとに個別質問できます"
        buttonLabel="Pro で試す →"
      />
      <section id="simulation" className="scroll-mt-24">
        <SectionHeading title="現物シミュレーション" note="現在付近で入った場合の利確・損切り・税金・為替影響" />
        <SpotEntrySimulator stock={stock} price={latest} news={tickerNews} score={scoreAnalysis.score} />
      </section>

      <section className="scroll-mt-24">
        <SectionHeading title="価格アラート" note="条件達成時にブラウザ通知でお知らせします" />
        <PriceAlertPanel
          ticker={stock.ticker}
          currentPrice={displayClose}
          currentRsi={latest?.rsi}
          currentVolumeRatio={latest?.volumeRatio}
        />
      </section>

      <section className="md:hidden">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-50">日次データ</h3>
            <p className="mt-1 text-xs text-slate-500">スマホでは日付・終値・前日比・RSI・出来高倍率・判定だけをカードで表示します。</p>
          </div>
          <HistoricalCsvButton prices={tablePrices} stock={stock} />
        </div>
        <div className="space-y-3">
          {tablePrices.map((price) => <MobileDailyCard key={price.date} price={price} stock={stock} />)}
        </div>
      </section>

      <div className="hidden md:block">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-50">日次データ</h3>
            <p className="mt-1 text-xs text-slate-500">表示中の過去データをCSVで出力できます。</p>
          </div>
          <HistoricalCsvButton prices={tablePrices} stock={stock} />
        </div>
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

function HistoricalCsvButton({ prices, stock }: { prices: DailyPrice[]; stock: Stock }) {
  function downloadCsv() {
    const headers = ["日付", "始値", "高値", "安値", "終値", "出来高", "前日比%", "出来高倍率", "RSI", "MACD", "MACD方向", "MA5", "MA20", "MA50", "スコア", "判定"];
    const rows = prices.map((price) => [
      price.date,
      formatStockPrice(price.open, stock),
      formatStockPrice(price.high, stock),
      formatStockPrice(price.low, stock),
      formatStockPrice(price.close, stock),
      `${Math.round(price.volume / 1000000)}M`,
      `${price.changePercent.toFixed(2)}%`,
      `${price.volumeRatio.toFixed(2)}x`,
      price.rsi.toFixed(2),
      price.macd.toFixed(2),
      price.macdDirection,
      formatStockPrice(price.ma5, stock),
      formatStockPrice(price.ma20, stock),
      formatStockPrice(price.ma50, stock),
      String(price.score),
      patternLabel(price)
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFilename(stock.ticker)}_historical_data_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      className="w-fit shrink-0 rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs font-black text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!prices.length}
      onClick={downloadCsv}
      type="button"
    >
      CSV出力
    </button>
  );
}

function DecisionSectionNav({
  activeSection,
  items
}: {
  activeSection: DecisionSectionId;
  items: Array<{ id: DecisionSectionId; label: string }>;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-white/10 bg-[#020617]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 [-webkit-overflow-scrolling:touch]">
      <div className="flex min-w-max gap-5">
        {items.map(({ id, label }) => {
          const active = id === activeSection;
          return (
            <a
              key={id}
              aria-current={active ? "page" : undefined}
              className={`border-b-2 px-0.5 py-2 text-sm transition hover:text-sky-100 ${
                active
                  ? "border-current font-medium text-sky-100"
                  : "border-transparent font-medium text-slate-500"
              }`}
              href={`#${id}`}
              onClick={(event) => handleClick(event, id)}
            >
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function ProCtaBar({
  title,
  description,
  buttonLabel
}: {
  title: string;
  description: string;
  buttonLabel: string;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    console.log("Pro CTA clicked");
  }

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border-[0.5px] border-white/10 bg-slate-900/70 px-4 py-3 shadow-lg shadow-black/15 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-100">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <a
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-sky-300/35 bg-sky-300/10 px-4 text-sm font-bold text-sky-100 transition hover:bg-sky-300/20"
        href="#"
        onClick={handleClick}
      >
        {buttonLabel}
      </a>
    </aside>
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

function SimilarPatternCard({ horizon }: { horizon: PatternHorizon }) {
  const isUp = horizon.averageReturn >= 0;

  return (
    <article className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/55 p-3 shadow-lg shadow-black/15 sm:p-4">
      <div className="flex min-h-6 items-start justify-between gap-2">
        <p className="text-[11px] font-bold text-slate-400 sm:text-xs">{horizon.days}営業日後</p>
        {horizon.days === 10 ? (
          <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-1.5 py-0.5 text-[9px] font-bold leading-none text-sky-200 sm:px-2 sm:text-[10px]">
            最も信頼性高
          </span>
        ) : null}
      </div>
      <p className={isUp ? "mt-3 text-2xl font-black tracking-tight text-green-300 tabular-nums sm:text-3xl" : "mt-3 text-2xl font-black tracking-tight text-red-300 tabular-nums sm:text-3xl"}>
        {isUp ? "+" : ""}{horizon.averageReturn.toFixed(2)}%
      </p>
      <div className="mt-3 space-y-1 text-[11px] font-semibold leading-5 text-slate-400 sm:text-xs">
        <p>上昇確率 {horizon.winRate.toFixed(0)}%</p>
        <p>{horizon.sampleCount}件の類似</p>
      </div>
    </article>
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

function csvCell(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

function patternLabel(price: Pick<DailyPrice, "pattern" | "score" | "high20Breakout">) {
  return price.pattern || price.high20Breakout || (price.score >= 6 ? "類似上昇候補" : "通常");
}

function isJpyStock(stock: Stock) {
  return isJpyStockTicker(stock.ticker) || stock.exchange === "TSE";
}

function isJpyStockTicker(ticker: string) {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker);
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
        <MobileMetric label="RSI" value={price.rsi.toFixed(2)} tone={price.rsi >= 70 ? "warn" : price.rsi >= 55 ? "up" : "default"} />
        <MobileMetric label="出来高倍率" value={`${price.volumeRatio.toFixed(2)}x`} tone={price.volumeRatio >= 1.2 ? "up" : "default"} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
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

// ─── メトリクスピル（ヘッダー用）────────────────────────────────────────
function MetricPill({ label, value, tone }: { label: string; value: string; tone: "green" | "red" | "neutral" }) {
  const cls =
    tone === "green"
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
      : tone === "red"
        ? "border-red-300/30 bg-red-300/10 text-red-200"
        : "border-white/10 bg-white/5 text-slate-400";
  return (
    <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${cls}`}>
      <span className="text-[10px] font-normal opacity-70">{label} </span>{value}
    </span>
  );
}

function PatternCell({ pattern, score, high20Breakout }: { pattern: string; score: number; high20Breakout: string }) {
  const label = patternLabel({ pattern, score, high20Breakout });
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
