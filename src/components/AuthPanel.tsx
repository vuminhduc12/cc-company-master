"use client";

import { useState } from "react";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";

export function AuthPanel() {
  const auth = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [status, setStatus] = useState<"idle" | "running" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  async function submit() {
    setStatus("running");
    setMessage("");
    try {
      if (mode === "signIn") {
        await auth.signIn(email.trim(), password);
        setMessage("ログインしました。WatchlistはSupabaseに同期されます。");
      } else {
        await auth.signUp(email.trim(), password);
        setMessage("アカウントを作成しました。メール確認が必要な設定の場合は受信箱を確認してください。");
      }
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "認証に失敗しました。");
    }
  }

  async function signOut() {
    setStatus("running");
    setMessage("");
    try {
      await auth.signOut();
      setStatus("done");
      setEmail("");
      setPassword("");
      setMessage("ログアウトしました。未ログイン時はlocalStorage保存に戻ります。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "ログアウトに失敗しました。");
    }
  }

  // ─── ログイン済み ───────────────────────────────────────────────────
  if (!auth.loading && auth.user) {
    const initials = auth.email
      ? auth.email.slice(0, 2).toUpperCase()
      : "U";

    return (
      <section className="rounded-2xl border border-emerald-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">User Account</p>
        <div className="mt-4 flex items-center gap-4">
          {/* アバター */}
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 text-xl font-black text-emerald-100">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black text-slate-50">{auth.email}</p>
            <p className="mt-0.5 text-xs text-slate-500">ID: {auth.user.id.slice(0, 8)}…</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-300/35 bg-emerald-300/10 px-2.5 py-0.5 text-[11px] font-black text-emerald-100">
                ✓ DB Sync Active
              </span>
              <span className="rounded-full border border-sky-300/25 bg-sky-300/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-sky-200">
                Watchlist同期中
              </span>
            </div>
          </div>
          <button
            className="shrink-0 rounded-xl border border-red-300/25 bg-red-400/10 px-4 py-2 text-sm font-black text-red-200 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status === "running"}
            onClick={() => void signOut()}
          >
            {status === "running" ? "…" : "ログアウト"}
          </button>
        </div>
        {message && (
          <p className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
            status === "error"
              ? "border-red-300/25 bg-red-400/10 text-red-100"
              : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
          }`}>
            {message}
          </p>
        )}
      </section>
    );
  }

  // ─── セッション確認中 ───────────────────────────────────────────────
  if (auth.loading) {
    return (
      <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">User Account</p>
        <div className="mt-4 flex items-center gap-3">
          <div className="size-10 animate-pulse rounded-xl bg-slate-700/50" />
          <p className="text-sm text-slate-500">セッションを確認中…</p>
        </div>
      </section>
    );
  }

  // ─── 未ログイン ─────────────────────────────────────────────────────
  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">User Account</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">ログイン / 新規登録</h3>
          <p className="mt-1 text-sm text-slate-400">
            ログインするとWatchlist・アラートをデバイス間で同期します。
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full border border-yellow-300/35 bg-yellow-300/10 px-3 py-1 text-xs font-black text-yellow-100">
          Local Mode
        </span>
      </div>

      {/* タブ切り替え */}
      <div className="mt-5 flex gap-1 rounded-xl border border-white/10 bg-slate-950/50 p-1">
        <button
          className={`flex-1 rounded-lg py-2 text-sm font-black transition ${
            mode === "signIn"
              ? "bg-cyan-300 text-slate-950 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
          onClick={() => { setMode("signIn"); setMessage(""); }}
          type="button"
        >
          ログイン
        </button>
        <button
          className={`flex-1 rounded-lg py-2 text-sm font-black transition ${
            mode === "signUp"
              ? "bg-cyan-300 text-slate-950 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
          onClick={() => { setMode("signUp"); setMessage(""); }}
          type="button"
        >
          新規登録
        </button>
      </div>

      {/* フォーム */}
      <div className="mt-4 space-y-3">
        <input
          className="block w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-50 placeholder-slate-600 outline-none transition focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-300/20"
          autoComplete="email"
          placeholder="メールアドレス"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        />
        <input
          className="block w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-50 placeholder-slate-600 outline-none transition focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-300/20"
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          placeholder={mode === "signUp" ? "パスワード（6文字以上）" : "パスワード"}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        />
        <button
          className="w-full rounded-xl bg-cyan-300 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={status === "running" || !email || (mode === "signIn" ? !password : password.length < 6)}
          onClick={() => void submit()}
        >
          {status === "running"
            ? "処理中…"
            : mode === "signIn"
              ? "ログイン"
              : "アカウントを作成"}
        </button>
      </div>

      {/* 設定されていない場合の注意 */}
      {auth.authMessage && !auth.configured && (
        <p className="mt-3 rounded-xl border border-yellow-300/25 bg-yellow-300/10 px-3 py-2 text-xs leading-5 text-yellow-100">
          {auth.authMessage}
        </p>
      )}
      {message && (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
          status === "error"
            ? "border-red-300/25 bg-red-400/10 text-red-100"
            : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
        }`}>
          {message}
        </p>
      )}
    </section>
  );
}
