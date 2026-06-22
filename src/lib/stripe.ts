import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function hasStripeConfig() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

// CheckoutやポータルのリダイレクトURLに使うアプリのベースURL。
export function appBaseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return fromEnv || "http://localhost:3000";
}
