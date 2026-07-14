// Web search tool — the AI can search the internet when it doesn't know something.
// The tutor does not pretend to know things it doesn't.
// It says "Give me a second, let me look that up" and actually does it.

import axios from "axios";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export async function searchWeb(
  query: string,
  reason: "curriculum_lookup" | "fact_check" | "analogy_find" | "syllabus_verify"
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    console.warn("[Search] No BRAVE_SEARCH_API_KEY — returning empty results");
    return [];
  }

  try {
    const response = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      params: {
        q: query,
        count: 5,
        safesearch: "moderate",
        search_lang: "en",
        country: "NG", // Bias toward Nigerian sources when relevant
      },
    });

    const results: SearchResult[] = (response.data.web?.results ?? []).map(
      (r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })
    );

    return results;
  } catch (error) {
    console.error("[Search] Brave search failed:", error);
    return [];
  }
}

export async function formatSearchResultsForLLM(results: SearchResult[]): Promise<string> {
  if (results.length === 0) {
    return "No search results found.";
  }

  return results
    .slice(0, 3)
    .map((r, i) => `[Result ${i + 1}]\nTitle: ${r.title}\nSnippet: ${r.snippet}`)
    .join("\n\n");
}