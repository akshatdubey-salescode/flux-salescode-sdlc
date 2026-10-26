// A thin client for MiniMax's Anthropic-compatible Messages API. No SDK: one fetch, a timeout, a couple of retries.
//
// Config: MINIMAX_API_KEY is the only required setting. MINIMAX_MODEL, MINIMAX_BASE_URL and MINIMAX_EFFORT are
// optional overrides of the defaults below. The key is read per call, never logged, never returned.
//
// MiniMax specifics (from its docs): temperature/top_p are ignored; thinking tokens count toward max_tokens
// (too small a value ends with stop_reason "max_tokens" and no text); MiniMax-M3.1-Flash always thinks and takes
// output_config.effort; thinking blocks come back in `content` and are dropped here.

export const DEFAULT_MINIMAX_MODEL = "MiniMax-M3.1-Flash";
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";
const DEFAULT_EFFORT = "medium";
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export type LlmConfig = { apiKey: string; model: string; baseUrl: string; effort: string };

/** The configuration, or null when no key is set (the AI review is then switched off everywhere). */
export function getLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return null;
  const effort = env.MINIMAX_EFFORT?.trim().toLowerCase();
  return {
    apiKey,
    model: env.MINIMAX_MODEL?.trim() || DEFAULT_MINIMAX_MODEL,
    baseUrl: (env.MINIMAX_BASE_URL?.trim() || DEFAULT_MINIMAX_BASE_URL).replace(/\/+$/, ""),
    effort: effort && EFFORTS.has(effort) ? effort : DEFAULT_EFFORT,
  };
}

export const isLlmConfigured = (): boolean => getLlmConfig() !== null;

export type LlmTool = { name: string; description: string; input_schema: Record<string, unknown> };
export type LlmMessage = { role: "user" | "assistant"; content: string | Record<string, unknown>[] };

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  tools?: LlmTool[];
  /** Force the model to call this tool. */
  forceTool?: string;
  timeoutMs?: number;
};

export type LlmBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type LlmResponse = {
  blocks: LlmBlock[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

/**
 * `quota`: the plan's tokens/credits/usage window are used up (retrying is pointless until it resets or is topped up).
 * `auth`: the key was rejected. `rate_limited`: too many requests right now (clears by itself).
 */
export type LlmErrorCode = "not_configured" | "auth" | "quota" | "rate_limited" | "bad_request" | "server" | "timeout" | "network" | "empty";

/** Codes that mean the service itself can't be used for now (not a one-off problem with one request). */
export const isServiceProblem = (code: LlmErrorCode): boolean => code === "quota" || code === "auth" || code === "rate_limited" || code === "server" || code === "timeout" || code === "network";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: LlmErrorCode,
    readonly status?: number,
  ) {
    super(message);
  }
}

const QUOTA_WORDS = /quota|insufficient|balance|credit|top.?up|exceed(ed)? (the )?(usage|limit|token)|usage limit|token (plan|limit)|plan.*(limit|expired)|expired|out of (tokens|credits)|billing|payment/i;
// MiniMax's own status codes (base_resp.status_code): 1008 insufficient balance, 2056 usage limit exceeded.
const QUOTA_CODES = new Set([1008, 2056]);

/** The provider's own message from an error body (Anthropic-style or MiniMax base_resp), trimmed; never the request. */
export function providerMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string; base_resp?: { status_msg?: string } };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? j.base_resp?.status_msg ?? "");
    return String(m).slice(0, 240);
  } catch {
    return body.slice(0, 240);
  }
}

/** What kind of failure an error response is. Exported for tests. */
export function classifyHttpError(status: number, body: string): { code: LlmErrorCode; message: string } {
  const detail = providerMessage(body);
  let providerCode: number | null = null;
  try {
    const c = (JSON.parse(body) as { base_resp?: { status_code?: number } })?.base_resp?.status_code;
    if (typeof c === "number") providerCode = c;
  } catch {
    /* not JSON */
  }
  const quota = status === 402 || (providerCode !== null && QUOTA_CODES.has(providerCode)) || ((status === 429 || status === 403 || status === 400) && QUOTA_WORDS.test(`${detail} ${body.slice(0, 400)}`));
  if (quota) return { code: "quota", message: `The AI service's quota or balance is used up${detail ? `: ${detail}` : "."}` };
  if (status === 401 || status === 403) return { code: "auth", message: "The AI service rejected the API key." };
  if (status === 429) return { code: "rate_limited", message: "The AI service is rate limiting requests. Try again shortly." };
  if (status >= 500) return { code: "server", message: `The AI service had an error (${status}).` };
  return { code: "bad_request", message: `The AI service refused the request (${status})${detail ? `: ${detail}` : "."}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Builds the request body (exported for tests). Thinking is left at the model's default; effort only where it applies. */
export function buildBody(cfg: LlmConfig, req: LlmRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  };
  if (/flash/i.test(cfg.model)) body.output_config = { effort: cfg.effort };
  if (req.tools?.length) {
    body.tools = req.tools;
    if (req.forceTool) body.tool_choice = { type: "tool", name: req.forceTool };
  }
  return body;
}

/** Parses a Messages response, keeping only text and tool_use blocks (thinking is dropped). Exported for tests. */
export function parseResponse(json: unknown, fallbackModel: string): LlmResponse {
  const j = (json ?? {}) as {
    content?: unknown;
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    model?: string;
  };
  const blocks: LlmBlock[] = [];
  if (Array.isArray(j.content)) {
    for (const b of j.content as Record<string, unknown>[]) {
      if (b?.type === "text" && typeof b.text === "string") blocks.push({ type: "text", text: b.text });
      else if (b?.type === "tool_use" && typeof b.name === "string") {
        blocks.push({ type: "tool_use", id: String(b.id ?? ""), name: b.name, input: b.input });
      }
    }
  }
  return {
    blocks,
    stopReason: j.stop_reason ?? null,
    // With prompt caching the provider reports the cached part separately, and input_tokens can be tiny (even 1).
    inputTokens: Number(j.usage?.input_tokens ?? 0) + Number(j.usage?.cache_read_input_tokens ?? 0) + Number(j.usage?.cache_creation_input_tokens ?? 0),
    outputTokens: Number(j.usage?.output_tokens ?? 0),
    model: j.model ?? fallbackModel,
  };
}

/** One Messages call. Retries 429 and 5xx twice with backoff; never includes the key or the prompt in an error. */
export async function callLlm(req: LlmRequest, cfg: LlmConfig | null = getLlmConfig()): Promise<LlmResponse> {
  if (!cfg) throw new LlmError("The AI review is not configured.", "not_configured");
  const body = JSON.stringify(buildBody(cfg, req));
  let lastError: LlmError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "anthropic-version": "2023-06-01" },
        body,
        signal: AbortSignal.timeout(req.timeoutMs ?? 240_000),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      lastError = new LlmError(timedOut ? "The AI service took too long to answer." : "Could not reach the AI service.", timedOut ? "timeout" : "network");
      continue;
    }

    if (res.ok) {
      const json = await res.json().catch(() => null);
      // Some gateways answer 200 with an error body.
      if ((json as { type?: string } | null)?.type === "error") {
        const c = classifyHttpError(429, JSON.stringify(json));
        if (c.code === "quota") throw new LlmError(c.message, "quota", 200);
        throw new LlmError(c.message === "The AI service is rate limiting requests. Try again shortly." ? c.message : "The AI service returned an error.", "server", 200);
      }
      const parsed = parseResponse(json, cfg.model);
      if (parsed.blocks.length === 0) {
        throw new LlmError(
          parsed.stopReason === "max_tokens" ? "The AI ran out of room before answering (output limit)." : "The AI returned no answer.",
          "empty",
        );
      }
      return parsed;
    }

    const failure = classifyHttpError(res.status, (await res.text().catch(() => "")).slice(0, 2000));
    // Quota and key problems won't fix themselves within a retry; a plain rate limit or server error might.
    if (failure.code === "quota" || failure.code === "auth" || failure.code === "bad_request") throw new LlmError(failure.message, failure.code, res.status);
    lastError = new LlmError(failure.message, failure.code, res.status);
  }
  throw lastError ?? new LlmError("The AI service failed.", "server");
}
