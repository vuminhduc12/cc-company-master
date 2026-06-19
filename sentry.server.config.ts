/**
 * Sentry サーバーサイド設定（Node.js runtime）
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  enabled: process.env.NODE_ENV === "production",

  // cron ジョブのチェックイン監視（Vercel Cron が動いているか確認）
  // 有効化するには Sentry の Cron Monitoring を設定してください
  // monitorSlug: "daily-stock-job",
});
