import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { planKeyFromPriceId, type PlanKey } from "@/lib/plans";
import { getStripe, hasStripeConfig } from "@/lib/stripe";
import { updateUserPlanByCustomerId, upsertUserPlanByUserId } from "@/lib/user-plan";

export const dynamic = "force-dynamic";

// 署名検証のため raw body を使う（パース前の本文が必要）。
export async function POST(request: Request) {
  if (!hasStripeConfig()) {
    return NextResponse.json({ ok: false, error: "Stripe未設定。" }, { status: 503 });
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: "STRIPE_WEBHOOK_SECRET未設定。" }, { status: 503 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ ok: false, error: "Stripe初期化失敗。" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "stripe-signatureヘッダーがありません。" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "署名検証に失敗しました。";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
        const planFromMeta = session.metadata?.plan as PlanKey | undefined;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
        if (userId) {
          await upsertUserPlanByUserId(userId, {
            plan: planFromMeta ?? "pro",
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            subscriptionStatus: "active"
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const priceId = sub.items.data[0]?.price?.id;
        const planFromPrice = planKeyFromPriceId(priceId);
        const active = sub.status === "active" || sub.status === "trialing";
        await updateUserPlanByCustomerId(customerId, {
          plan: active ? planFromPrice ?? undefined : "free",
          subscriptionStatus: sub.status,
          stripeSubscriptionId: sub.id
        });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        await updateUserPlanByCustomerId(customerId, {
          plan: "free",
          subscriptionStatus: "canceled"
        });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook処理に失敗しました。";
    // 500を返すとStripeが再送する。永続層のエラーは再送に委ねる。
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, received: true });
}
