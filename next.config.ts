import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(process.cwd())
};

// Sentry が npm install 済みの場合のみ有効化
// セットアップ: npm install @sentry/nextjs → NEXT_PUBLIC_SENTRY_DSN を env に追加
let exportedConfig: NextConfig = nextConfig;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withSentryConfig } = require("@sentry/nextjs");
  exportedConfig = withSentryConfig(nextConfig, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    hideSourceMaps: true,
    disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
    disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  });
} catch {
  // @sentry/nextjs 未インストール時はそのまま動作する
}

export default exportedConfig;
