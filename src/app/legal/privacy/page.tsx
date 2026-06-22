import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | D Finance AI Stock Manager"
};

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-2xl font-black text-slate-50">プライバシーポリシー</h1>
      <p className="mt-2 text-xs text-slate-500">最終改定日: 2026-06-22 / バージョン v1</p>

      <Section title="1. 取得する情報">
        メールアドレス（アカウント登録時）、認証情報、Watchlist・アラート等の利用データ、AI利用ログ、決済に関する情報（Stripe社が処理し、当方はカード番号を保持しません）、アクセスログ等を取得します。
      </Section>

      <Section title="2. 利用目的">
        本サービスの提供・認証、プラン管理と課金、利用上限の管理、品質改善、不正利用の防止、法令対応のために利用します。
      </Section>

      <Section title="3. 第三者提供・委託">
        認証・データ保存にSupabase、決済にStripe、ホスティングにVercel、AI分析にOpenAI等の外部サービスを利用します。これらの委託先には目的の範囲で必要な情報のみを提供します。
      </Section>

      <Section title="4. Cookie・ローカルストレージ">
        ログインセッションの維持や同意状態の保存のためにCookieおよびブラウザのローカルストレージを使用します。
      </Section>

      <Section title="5. 保存期間">
        AI利用ログは既定で約90日保持し、その後削除されます。アカウント削除時は関連データを削除します。
      </Section>

      <Section title="6. 開示・訂正・削除の請求">
        利用者は自己の個人情報の開示・訂正・削除を請求できます。請求は「特定商取引法に基づく表記」記載の連絡先までご連絡ください。
      </Section>

      <Section title="7. 改定">
        本ポリシーは必要に応じて改定し、重要な変更は本サービス上で告知します。
      </Section>

      <p className="mt-8 text-xs text-slate-500">
        本ポリシーは雛形です。公開前に必ず専門家のレビューを受けてください。
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-bold text-slate-100">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}
