"use client";

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const showDebugDetails = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-bold text-red-400">エラーが発生しました</p>
      <p className="max-w-xl text-sm leading-6 text-slate-300">
        画面の読み込み中に問題が発生しました。再試行しても解決しない場合は、時間をおいてもう一度お試しください。
      </p>
      {showDebugDetails ? (
        <pre className="max-w-xl overflow-auto rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-left text-[11px] text-red-300">
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
      ) : null}
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
