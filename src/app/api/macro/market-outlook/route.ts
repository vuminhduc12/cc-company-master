import { NextResponse } from "next/server";
import { callOpenAiChatWithUsageGuard, resolveAiUserFromRequest } from "@/lib/ai-usage";
import { buildMacroMarketOutlook, type MacroMarketOutlook } from "@/lib/macro-market";

export const dynamic = "force-dynamic";

type OpenAiMacroPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

type MacroAiComment = {
  aiComment?: string;
  summary?: string;
  scenario?: MacroMarketOutlook["scenario"];
  confidence?: MacroMarketOutlook["confidence"];
  drivers?: string[];
  risks?: string[];
};

export async function GET(request: Request) {
  const outlook = await buildMacroMarketOutlook();
  const searchParams = new URL(request.url).searchParams;
  const aiParam = searchParams.get("ai")?.toLowerCase();
  const shouldUseAi = aiParam === "1" || aiParam === "true" || aiParam === "on";
  if (!shouldUseAi) {
    return NextResponse.json({ ok: true, outlook });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      ok: true,
      outlook: {
        ...outlook,
        warning: outlook.warning ?? "OPENAI_API_KEY未設定のため、ルールベースの市場見通しを表示しています。"
      }
    });
  }

  const user = await resolveAiUserFromRequest(request);
  const prompt = buildMacroPrompt(outlook);
  const aiResult = await callOpenAiChatWithUsageGuard<OpenAiMacroPayload>({
    feature: "macro_market_analysis",
    userId: user.id,
    userEmail: user.email,
    model: "gpt-4o-mini",
    promptVersion: "macro-market-outlook-v1",
    estimatedInputTokens: Math.ceil(prompt.length / 4),
    apiKey,
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    }
  });

  if (!aiResult.ok) {
    return NextResponse.json({
      ok: true,
      outlook: {
        ...outlook,
        warning: aiResult.warning ?? outlook.warning
      }
    });
  }

  const parsed = parseAiComment(aiResult.payload?.choices?.[0]?.message?.content);
  return NextResponse.json({
    ok: true,
    outlook: {
      ...outlook,
      scenario: parsed.scenario ?? outlook.scenario,
      confidence: parsed.confidence ?? outlook.confidence,
      summary: parsed.summary ?? outlook.summary,
      drivers: parsed.drivers?.length ? parsed.drivers.slice(0, 5) : outlook.drivers,
      risks: parsed.risks?.length ? parsed.risks.slice(0, 4) : outlook.risks,
      aiComment: parsed.aiComment
    }
  });
}

function buildMacroPrompt(outlook: MacroMarketOutlook) {
  return [
    "あなたは日本語で説明する米国マクロ市場アナリストです。",
    "以下のFRED公開データだけを使い、CPI・Core CPI・FOMC政策金利レンジ・実効FF金利・米国債金利・VIX・S&P 500から米国株式市場の短期シナリオを条件付きで説明してください。",
    "FRB政策スタンスがグロース株、高PER株、小型株、景気敏感株にどう効きやすいかを、断定せずに説明してください。",
    "投資助言は禁止。予測は確定表現ではなく、条件付きの市場見通しとして書いてください。",
    "返却はJSONのみ。keys: summary, scenario, confidence, drivers, risks, aiComment。",
    "scenarioは risk_on, range, risk_off のいずれか。confidenceは 低, 中, 高。",
    JSON.stringify(outlook)
  ].join("\n");
}

function parseAiComment(content: string | undefined): MacroAiComment {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as MacroAiComment;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      scenario: parsed.scenario === "risk_on" || parsed.scenario === "range" || parsed.scenario === "risk_off" ? parsed.scenario : undefined,
      confidence: parsed.confidence === "低" || parsed.confidence === "中" || parsed.confidence === "高" ? parsed.confidence : undefined,
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers.map(String) : undefined,
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : undefined,
      aiComment: typeof parsed.aiComment === "string" ? parsed.aiComment : undefined
    };
  } catch {
    return {};
  }
}
