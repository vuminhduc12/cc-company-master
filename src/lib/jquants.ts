const JQUANTS_BASE_URL = "https://api.jquants.com/v2";

export function hasJQuantsConfig() {
  return Boolean(process.env.JQUANTS_API_KEY?.trim());
}

export async function fetchJQuants<T>(path: string, query: Record<string, string> = {}) {
  const apiKey = process.env.JQUANTS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("J-Quants APIキーが未設定です。JQUANTS_API_KEY を .env.local に追加してください。");
  }

  const url = new URL(`${JQUANTS_BASE_URL}${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
    next: { revalidate: 0 }
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("J-Quants APIキーが無効、または空売り残高報告データの利用権限がありません（スタンダードプラン以上が必要）。");
  }

  if (!response.ok) {
    throw new Error(`J-Quants API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
