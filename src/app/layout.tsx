import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { DisclaimerModal } from "@/components/DisclaimerModal";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "D Finance AI Stock Manager",
  description: "AI株スクリーナー — 投資情報補助ツール（投資助言サービスではありません）"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <AppShell>{children}</AppShell>
          <DisclaimerModal />
        </Providers>
      </body>
    </html>
  );
}
