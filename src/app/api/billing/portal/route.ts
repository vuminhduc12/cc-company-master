import { NextResponse } from "next/server";
import { resolveAiUserIdFromRequest } from "@/lib/ai-usage";
import { appBaseUrl, getStripe, hasStripeConfig } from "@/lib/stripe";
import { getUserPlanRow } from "@/lib/user-plan";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasStripeConfig()) {
    return NextResponse.json({ ok: false, error: "Stripeが未設定です（STRIPE_SECRET_KEY）。" }, { status: 503 });
  }

  const userId = await resolveAiUserIdFromRequest(request);
  if (userId === "local-user") {
    return NextResponse.json({ ok: false, error: "プラン管理にはログインが必要です。", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const row = await getUserPlanRow(userId);
  if (!row?.stripe_customer_id) {
    return NextResponse.json({ ok: false, error: "Stripe顧客情報が見つかりません。先にアップグレードしてください。" }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ ok: false, error: "Stripeクライアントを初期化できませんでした。" }, { status: 503 });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${appBaseUrl()}/settings`
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "顧客ポータルの作成に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
