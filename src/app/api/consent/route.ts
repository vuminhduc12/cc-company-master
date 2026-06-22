import { NextResponse } from "next/server";
import { resolveAiUserIdFromRequest } from "@/lib/ai-usage";
import { createServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const allowedDocuments = new Set(["disclaimer", "terms", "privacy"]);

// 同意の記録。ログイン済みユーザーのみDBに保存する。
// 未ログインはクライアント側のlocalStorageでUI制御するため、ここでは recorded:false を返す。
export async function POST(request: Request) {
  const userId = await resolveAiUserIdFromRequest(request);
  if (userId === "local-user") {
    return NextResponse.json({ ok: true, recorded: false, reason: "anonymous" });
  }

  const body = await request.json().catch(() => ({})) as { document?: string; version?: string };
  const document = String(body.document ?? "");
  const version = String(body.version ?? "");
  if (!allowedDocuments.has(document) || !version) {
    return NextResponse.json({ ok: false, error: "document と version が不正です。" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: true, recorded: false, reason: "supabase_not_configured" });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  const { error } = await supabase
    .from("user_consents")
    .upsert(
      { user_id: userId, document, version, agreed_at: new Date().toISOString(), user_agent: userAgent },
      { onConflict: "user_id,document,version" }
    );
  if (error) {
    return NextResponse.json({ ok: false, error: `同意の記録に失敗しました: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recorded: true });
}
