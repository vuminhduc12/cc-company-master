import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "利用規約 | D Finance AI Stock Manager"
};

export default function TermsPage() {
  return (
    <>
      <h1 className="text-2xl font-black text-slate-50">利用規約</h1>
      <p className="mt-2 text-xs text-slate-500">最終改定日: 2026-06-22 / バージョン v1</p>

      <Section title="第1条（適用）">
        本規約は、D Finance AI Stock Manager（以下「本サービス」）の利用に関する一切に適用されます。利用者は本規約に同意のうえ本サービスを利用するものとします。
      </Section>

      <Section title="第2条（サービスの性質・投資助言の否認）">
        本サービスは株式投資の補助情報を提供する情報整理ツールであり、金融商品取引法に基づく投資助言・代理業の登録を受けていません。「最注目」「注目」「AIスコア」等の表示は情報整理を目的としたものであり、特定の金融商品の売買を推奨・勧誘するものではありません。投資判断は利用者自身の責任で行ってください。
      </Section>

      <Section title="第3条（データの正確性）">
        表示されるデータは外部APIおよび過去データに基づき、遅延・欠損・誤りを含む場合があります。当方はデータの正確性・完全性・最新性を保証しません。
      </Section>

      <Section title="第4条（料金・プラン）">
        有料プラン（Pro / Premium）の料金、提供内容、支払時期等は、サービス内の表示および「特定商取引法に基づく表記」によります。決済はStripe社を通じて行われます。
      </Section>

      <Section title="第5条（解約）">
        利用者は設定画面の「プラン管理」からいつでも解約できます。解約は次回更新日以降に有効となり、既に支払われた料金は原則返金されません。
      </Section>

      <Section title="第6条（禁止事項）">
        法令違反、本サービスの運営妨害、リバースエンジニアリング、第三者への不正なアカウント共有等を禁止します。
      </Section>

      <Section title="第7条（免責）">
        当方は、本サービスの利用または利用不能により生じた損害（投資判断に基づく損失を含む）について、当方の故意・重過失による場合を除き責任を負いません。
      </Section>

      <Section title="第8条（規約の変更）">
        当方は必要に応じて本規約を変更できます。重要な変更は本サービス上で告知します。
      </Section>

      <p className="mt-8 text-xs text-slate-500">
        本規約は雛形です。公開前に必ず専門家（弁護士等）のレビューを受けてください。
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
