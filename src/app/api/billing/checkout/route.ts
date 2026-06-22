import { NextResponse } from "next/server";
import { resolveAiUserIdFromRequest } from "@/lib/ai-usage";
import { normalizePlanKey, priceIdForPlan } from "@/lib/plans";
import { appBaseUrl, getStripe, hasStripeConfig } from "@/lib/stripe";
import { getUserPlanRow } from "@/lib/user-plan";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasStripeConfig()) {
    return NextResponse.json({ ok: false, error: "Stripeが未設定です（STRIPE_SECRET_KEY）。" }, { status: 503 });
  }

  const userId = await resolveAiUserIdFromRequest(request);
  if (userId === "local-user") {
    return NextResponse.json({ ok: false, error: "アップグレードにはログインが必要です。", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { plan?: string };
  const plan = normalizePlanKey(body.plan);
  if (plan === "free") {
    return NextResponse.json({ ok: false, error: "アップグレード先のプラン(pro/premium)を指定してください。" }, { status: 400 });
  }

  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json({ ok: false, error: `${plan} の Stripe Price ID（STRIPE_PRICE_${plan.toUpperCase()}）が未設定です。` }, { status: 503 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ ok: false, error: "Stripeクライアントを初期化できませんでした。" }, { status: 503 });
  }

  const existing = await getUserPlanRow(userId);
  const base = appBaseUrl();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : {}),
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } },
      success_url: `${base}/settings?billing=success`,
      cancel_url: `${base}/settings?billing=cancelled`,
      allow_promotion_codes: true
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkoutセッションの作成に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
