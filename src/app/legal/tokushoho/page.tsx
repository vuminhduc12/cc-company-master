import type { Metadata } from "next";
import { planDefinitions } from "@/lib/plans";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 | D Finance AI Stock Manager"
};

const PLACEHOLDER = "【要記入】";

function env(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : PLACEHOLDER;
}

export default function TokushohoPage() {
  const rows: { label: string; value: string }[] = [
    { label: "販売事業者", value: env("LEGAL_BUSINESS_NAME") },
    { label: "運営統括責任者", value: env("LEGAL_BUSINESS_OPERATOR") },
    { label: "所在地", value: env("LEGAL_BUSINESS_ADDRESS") },
    { label: "電話番号", value: env("LEGAL_BUSINESS_PHONE") },
    { label: "メールアドレス", value: env("LEGAL_BUSINESS_CONTACT") },
    {
      label: "販売価格",
      value: `Pro: 月額 ¥${planDefinitions.pro.monthlyPriceJpy.toLocaleString("ja-JP")} / Premium: 月額 ¥${planDefinitions.premium.monthlyPriceJpy.toLocaleString("ja-JP")}（いずれも税込表示）`
    },
    { label: "商品代金以外の必要料金", value: "インターネット接続に必要な通信費等はお客様のご負担となります。" },
    { label: "支払方法", value: "クレジットカード（Stripe社の決済システムを利用）" },
    { label: "支払時期", value: "お申し込み時に初回決済、以降は毎月の更新日に自動課金されます。" },
    { label: "役務の提供時期", value: "決済完了後、ただちにご利用いただけます。" },
    {
      label: "解約・返金",
      value: "設定画面の「プラン管理」からいつでも解約できます。解約は次回更新日以降に有効となり、デジタルサービスの性質上、既にお支払い済みの料金の返金は原則行いません。"
    }
  ];

  const hasPlaceholder = rows.some((row) => row.value === PLACEHOLDER);

  return (
    <>
      <h1 className="text-2xl font-black text-slate-50">特定商取引法に基づく表記</h1>
      <p className="mt-2 text-xs text-slate-500">最終改定日: 2026-06-22</p>

      {hasPlaceholder ? (
        <p className="mt-4 rounded-xl border border-yellow-300/30 bg-yellow-300/10 px-4 py-3 text-xs leading-5 text-yellow-100">
          【要記入】の項目は環境変数（LEGAL_BUSINESS_NAME 等）で設定してください。実際の事業者情報の記載は法令上必須です。
        </p>
      ) : null}

      <dl className="mt-6 divide-y divide-white/10">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
            <dt className="font-bold text-slate-100">{row.label}</dt>
            <dd className={row.value === PLACEHOLDER ? "text-yellow-300" : "text-slate-300"}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
