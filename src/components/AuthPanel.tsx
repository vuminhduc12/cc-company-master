"use client";

import { useState } from "react";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";

export function AuthPanel() {
  const auth = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "error" | "done">("idle");
  const [message, setMessage] = useState("");

  async function submit(mode: "signIn" | "signUp") {
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
      setMessage("ログアウトしました。未ログイン時はlocalStorage保存に戻ります。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "ログアウトに失敗しました。");
    }
  }

  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">User Account</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">Supabase Auth</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            ログインするとWatchlistと削除状態をユーザー別にSupabaseへ保存します。未ログイン時は従来通りこのブラウザだけに保存します。
          </p>
        </div>
        <span className={auth.loading ? "w-fit rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100" : auth.user ? "w-fit rounded-full border border-emerald-300/35 bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-100" : "w-fit rounded-full border border-yellow-300/35 bg-yellow-300/10 px-3 py-1 text-xs font-black text-yellow-100"}>
          {auth.loading ? "Checking Session" : auth.user ? "DB Sync Active" : "Local Mode"}
        </span>
      </div>

      {auth.loading ? (
        <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-100">
          Supabaseセッションを確認中です。
        </div>
      ) : auth.user ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-black text-slate-100">{auth.email}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">User ID: {auth.user.id}</p>
          <button
            className="mt-3 rounded-xl border border-red-300/30 bg-red-400/10 px-4 py-2 text-sm font-black text-red-100 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status === "running"}
            onClick={() => void signOut()}
          >
            ログアウト
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]">
          <input
            className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-cyan-300/50"
            autoComplete="email"
            placeholder="メールアドレス"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-cyan-300/50"
            autoComplete="current-password"
            placeholder="パスワード"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status === "running" || !email || !password}
            onClick={() => void submit("signIn")}
          >
            ログイン
          </button>
          <button
            className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status === "running" || !email || password.length < 6}
            onClick={() => void submit("signUp")}
          >
            新規登録
          </button>
        </div>
      )}

      {auth.authMessage && !auth.configured ? (
        <p className="mt-3 rounded-xl border border-yellow-300/25 bg-yellow-300/10 px-3 py-2 text-xs leading-5 text-yellow-100">{auth.authMessage}</p>
      ) : null}
      {message ? (
        <p className={status === "error" ? "mt-3 rounded-xl border border-red-300/25 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-100" : "mt-3 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs leading-5 text-emerald-100"}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
