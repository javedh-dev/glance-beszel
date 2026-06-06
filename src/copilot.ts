export interface CopilotConfig {
  token: string;
  username: string;
}

export interface PremiumRequestUsageItem {
  product: string;
  sku: string;
  model: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

export interface PremiumRequestUsageReport {
  timePeriod: { year: number; month?: number; day?: number };
  user: string;
  product?: string;
  model?: string;
  usageItems: PremiumRequestUsageItem[];
}

export interface UsageSummaryItem {
  product: string;
  sku: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

export interface UsageSummaryReport {
  timePeriod: { year: number; month?: number; day?: number };
  user: string;
  repository?: string;
  product?: string;
  sku?: string;
  usageItems: UsageSummaryItem[];
}

export interface CopilotUsageParams {
  year?: number;
  month?: number;
  day?: number;
  model?: string;
  product?: string;
}

export class GitHubCopilotClient {
  private baseUrl = "https://api.github.com";
  private timeoutMs: number;

  constructor(private config: CopilotConfig, timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
  }

  private async apiFetch<T>(
    path: string,
    params?: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || (typeof v === "number" && isNaN(v))) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "glance-copilot-extension/1.0",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `GitHub API error (${res.status}) ${path}: ${text}`,
      );
    }

    return res.json() as Promise<T>;
  }

  async getPremiumRequestUsage(
    params?: CopilotUsageParams,
  ): Promise<PremiumRequestUsageReport> {
    return this.apiFetch<PremiumRequestUsageReport>(
      `/users/${this.config.username}/settings/billing/premium_request/usage`,
      params as Record<string, string | number>,
    );
  }

  async getAICreditUsage(
    params?: CopilotUsageParams,
  ): Promise<PremiumRequestUsageReport> {
    return this.apiFetch<PremiumRequestUsageReport>(
      `/users/${this.config.username}/settings/billing/ai_credit/usage`,
      params as Record<string, string | number>,
    );
  }

  async getUsageSummary(
    params?: CopilotUsageParams & { repository?: string; sku?: string },
  ): Promise<UsageSummaryReport> {
    return this.apiFetch<UsageSummaryReport>(
      `/users/${this.config.username}/settings/billing/usage/summary`,
      params as Record<string, string | number>,
    );
  }
}
