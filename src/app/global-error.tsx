"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = /chunk|loading chunk|failed to fetch dynamically imported module/i.test(error.message);

  return (
    <html lang="ja">
      <body className="min-h-screen bg-slate-950 text-slate-50">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
          <h1 className="text-xl font-black">ページの読み込みに失敗しました</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {isChunkError
              ? "デプロイ直後は古いキャッシュが残っている場合があります。再読み込みしてください。"
              : "一時的なエラーが発生しました。再読み込みをお試しください。"}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              className="rounded-full border border-sky-300/30 bg-sky-300/10 px-5 py-2 text-sm font-bold text-sky-100"
              onClick={() => reset()}
              type="button"
            >
              再試行
            </button>
            <button
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-bold text-slate-200"
              onClick={() => window.location.reload()}
              type="button"
            >
              ページを再読み込み
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
