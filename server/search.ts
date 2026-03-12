import type { SearchResultRecord } from "../src/types";

const DEFAULT_SEARCH_URL = "http://47.251.92.21:28712/search";

function resolveSearchUrl() {
  return String(
    process.env.LIBERTH_NEURAL_SEARCH_URL ||
      process.env.SEARCH_URL ||
      process.env.SEARXNG_URL ||
      DEFAULT_SEARCH_URL,
  )
    .trim()
    .replace(/\/+$/, "");
}

function toLanguageCode(language?: string) {
  const normalized = String(language || "en").trim().toLowerCase();
  if (!normalized) return "en-US";
  if (normalized.includes("zh") || normalized.includes("chinese")) return "zh-CN";
  if (normalized.includes("ja") || normalized.includes("japanese")) return "ja-JP";
  if (normalized.includes("ko") || normalized.includes("korean")) return "ko-KR";
  return "en-US";
}

export async function searchWeb(
  query: string,
  options?: { count?: number; language?: string; categories?: string[] },
): Promise<SearchResultRecord[]> {
  const safeQuery = String(query || "").trim();
  const count = Math.max(1, Math.min(10, Number(options?.count || 6)));
  if (!safeQuery) return [];

  const params = new URLSearchParams({
    q: safeQuery,
    format: "json",
    language: toLanguageCode(options?.language),
    categories: (options?.categories || ["general"]).join(","),
    safesearch: "1",
  });

  const response = await fetch(`${resolveSearchUrl()}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Search request failed (${response.status})`);
  }

  const payload = (await response.json()) as any;
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.slice(0, count).map((item: any) => ({
    title: String(item?.title || "").trim(),
    url: String(item?.url || "").trim(),
    snippet: String(item?.content || item?.snippet || "").trim(),
    source: String(item?.source || item?.engine || "web").trim(),
    engine: String(item?.engine || "").trim() || undefined,
  }));
}

export function formatSearchResults(results: SearchResultRecord[]) {
  if (!results.length) {
    return "没有找到可用搜索结果。";
  }

  return [
    "搜索结果：",
    ...results.map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        `来源: ${item.source}${item.engine ? ` (${item.engine})` : ""}`,
        `链接: ${item.url}`,
        item.snippet ? `摘要: ${item.snippet}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}

