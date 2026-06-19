/**
 * Sentry クライアントサイド設定
 * セットアップ手順:
 *   1. npm install @sentry/nextjs
 *   2. https://sentry.io でプロジェクトを作成（Next.js を選択）
 *   3. DSN を .env.local と Vercel 環境変数に追加:
 *      NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@oxxxxx.ingest.sentry.io/xxxxx
 *      SENTRY_AUTH_TOKEN=sntrys_xxxxx（ソースマップアップロード用）
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 本番は 10%、開発は 100% サンプリング
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // セッションリプレイは本番のみ（エラー時のみ録画で容量節約）
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.0,

  // 開発環境ではコンソールに出力（Sentry に送信しない）
  enabled: process.env.NODE_ENV === "production",

  // エラーフィルタリング: ユーザー起因のエラーを除外
  beforeSend(event) {
    // ネットワークエラー（APIブロック等）は Sentry に送らない
    const msg = event.exception?.values?.[0]?.value ?? "";
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) return null;
    return event;
  },

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
