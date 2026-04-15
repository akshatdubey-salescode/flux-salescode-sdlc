export type CharjanCitation = {
  id: string;
  title: string;
  snippet: string;
  relevance_score: number;
};

export type CharjanSearchResult = {
  answer: string;
  citations: CharjanCitation[];
};

/**
 * Calls charjan's search + synthesis endpoint (streaming SSE) and collects
 * the full synthesized answer and citations.
 *
 * Env vars required:
 *   CHARJAN_API_URL    — base URL, e.g. https://salesforge-uat.salescode.ai
 *   CHARJAN_TENANT_ID  — tenant UUID
 *   CHARJAN_API_KEY    — X-API-Key header (optional)
 */
export async function searchCharjan(
  query: string,
  strategy: "INSTANT" | "FAST" | "FULL" | "AUTO" = "FULL"
): Promise<CharjanSearchResult> {
  const apiUrl = process.env.CHARJAN_API_URL;
  const apiKey = process.env.CHARJAN_API_KEY;
  const tenantId = process.env.CHARJAN_TENANT_ID;

  if (!apiUrl || !tenantId) {
    throw new Error(
      "Missing charjan configuration. Set CHARJAN_API_URL and CHARJAN_TENANT_ID."
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const response = await fetch(
    `${apiUrl}/api/v1/datastore/search/${tenantId}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        strategy,
        include_answer: true,
        top_k: 5,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Charjan search failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`
    );
  }

  const result: CharjanSearchResult = { answer: "", citations: [] };

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from charjan");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const event = parsed as {
        citations?: CharjanCitation[];
        token?: string;
        answer?: string;
      };

      if (event.citations) {
        result.citations = event.citations;
      }
      if (event.token) {
        result.answer += event.token;
      }
      if (event.answer) {
        // search-end event has the full answer; prefer this over accumulated tokens
        result.answer = event.answer;
      }
    }
  }

  return result;
}
