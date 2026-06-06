export interface OpenRouterConfig {
  apiKey: string;
}

export interface OpenRouterCredits {
  usage: number;
  limit: number;
  remaining: number;
  isFree: boolean;
  label: string;
}

export class OpenRouterClient {
  private baseUrl = "https://openrouter.ai/api/v1";
  private timeoutMs: number;

  constructor(private config: OpenRouterConfig, timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenRouter API error (${res.status})`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  private extractData(body: Record<string, unknown>): Record<string, unknown> {
    const d = body?.data;
    return (d && typeof d === "object" ? d : body) as Record<string, unknown>;
  }

  async getCredits(): Promise<OpenRouterCredits> {
    let data: Record<string, unknown>;

    data = {};
    // Try credits endpoint — has total_credits/total_usage for most users
    try {
      data = this.extractData(await this.fetchJson(`${this.baseUrl}/credits`));
    } catch {
      // Fallback: auth/key endpoint (returns limit/usage for some account types)
      try {
        data = this.extractData(await this.fetchJson(`${this.baseUrl}/auth/key`));
      } catch {
        // Both failed
      }
    }

    const usage = safeNum(data.usage);
    const limit = safeNum(data.limit);
    const creditLeft = safeNum(data.credit_left);
    const balance = safeNum(data.balance);
    const totalCredits = safeNum(data.total_credits);
    const totalUsage = safeNum(data.total_usage);

    let remaining = 0;
    let effectiveLimit = 0;
    let effectiveUsage = 0;

    if (creditLeft > 0) {
      remaining = creditLeft;
      effectiveLimit = creditLeft;
    } else if (balance > 0) {
      remaining = balance;
      effectiveLimit = balance;
    } else if (totalCredits > 0) {
      effectiveLimit = totalCredits;
      effectiveUsage = Math.min(totalUsage, totalCredits);
      remaining = Math.max(0, totalCredits - totalUsage);
    } else if (limit > 0) {
      effectiveLimit = limit;
      effectiveUsage = Math.max(0, usage);
      remaining = Math.max(0, limit - usage);
    }

    return {
      usage: effectiveUsage,
      limit: effectiveLimit,
      remaining,
      isFree: !!data.is_free,
      label: String(data.label ?? ""),
    };
  }
}

function safeNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
