"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "dfinance.disclaimer.v1";

export function DisclaimerModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // localStorage で「同意済み」を確認
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // プライベートブラウジング等で localStorage が使えない場合は表示しない
    }
  }, []);

  function handleAgree() {
    try {
      localStorage.setItem(STORAGE_KEY, "agreed");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm" />

      {/* モーダル本体 */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-yellow-300/20 bg-slate-900 p-6 shadow-2xl shadow-black/60 ring-1 ring-white/5">
        {/* アイコン＋タイトル */}
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-yellow-300/30 bg-yellow-300/10 text-2xl">
            ⚠️
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-50">ご利用前の重要なご確認</h2>
            <p className="mt-1 text-xs text-yellow-300/80 font-semibold uppercase tracking-wider">
              投資判断補助ツール — 投資助言サービスではありません
            </p>
          </div>
        </div>

        {/* 本文 */}
        <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
          <p>
            本サービス（D Finance AI Stock Manager）は、株式投資の<strong className="text-slate-50">補助情報を提供する個人向けツール</strong>です。
            以下の点をご確認の上、ご利用ください。
          </p>

          <ul className="space-y-2">
            <DisclaimerItem>
              本サービスは<strong>金融商品取引法に基づく投資助言業の登録を受けていません</strong>。
              表示される「Strong Buy」「AIスコア」等は情報整理の目的のみであり、
              <strong>売買を推奨するものではありません</strong>。
            </DisclaimerItem>
            <DisclaimerItem>
              すべての投資判断・損益は<strong>ご自身の責任と判断</strong>で行ってください。
              本サービスは投資の結果について一切の責任を負いません。
            </DisclaimerItem>
            <DisclaimerItem>
              表示データは外部APIから取得しており、<strong>遅延・欠損・誤りが含まれる場合</strong>があります。
              売買前に必ず証券会社の公式情報をご確認ください。
            </DisclaimerItem>
            <DisclaimerItem>
              過去のパターン分析・AIスコアは<strong>将来の株価を保証しません</strong>。
            </DisclaimerItem>
          </ul>
        </div>

        {/* 同意ボタン */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            「同意して利用する」を押すことで上記の内容を理解・同意したものとみなします。
          </p>
          <button
            className="shrink-0 rounded-xl bg-cyan-300 px-6 py-2.5 text-sm font-black text-slate-950 hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
            onClick={handleAgree}
            autoFocus
          >
            同意して利用する
          </button>
        </div>
      </div>
    </div>
  );
}

function DisclaimerItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-yellow-300">•</span>
      <span>{children}</span>
    </li>
  );
}
