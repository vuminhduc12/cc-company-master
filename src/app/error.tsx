"use client";

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-bold text-red-400">エラーが発生しました</p>
      {/* 開発デバッグ用: エラー内容を表示 */}
      <pre className="max-w-xl overflow-auto rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-left text-[11px] text-red-300">
        {error.message}
        {"\n\n"}
        {error.stack}
      </pre>
      <button
        className="rounded-full border border-sky-300/30 bg-sky-300/10 px-5 py-2 text-sm font-bold text-sky-100"
        onClick={() => reset()}
        type="button"
      >
        再試行
      </button>
    </div>
  );
}
