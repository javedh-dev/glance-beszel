import "dotenv/config";
import express, { Request, Response } from "express";
import compression from "compression";
import { BeszelClient, BeszelConfig } from "./beszel";
import { renderWidget, RenderOptions, SystemBundle } from "./template";
import { GitHubCopilotClient, CopilotConfig } from "./copilot";
import { renderCopilotWidget, CopilotRenderOptions } from "./copilot-template";
import { OpenRouterClient } from "./openrouter";
import {
  renderOpenRouterWidget,
  OpenRouterRenderOptions,
} from "./openrouter-template";

// ---- Config from environment variables ----

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`ERROR: Required environment variable "${name}" is not set.`);
    process.exit(1);
  }
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const beszelConfig: BeszelConfig = {
  url: requireEnv("BESZEL_URL"),
  email: requireEnv("BESZEL_EMAIL"),
  password: requireEnv("BESZEL_PASSWORD"),
};

const PORT = parseInt(optionalEnv("PORT", "8088"), 10);
const WIDGET_TITLE = optionalEnv("WIDGET_TITLE", "Beszel");
const WIDGET_TITLE_URL = optionalEnv("WIDGET_TITLE_URL", beszelConfig.url);
const SHOW_ALERTS = optionalEnv("SHOW_ALERTS", "true") === "true";
const SYSTEM_FILTER = optionalEnv("SYSTEM_FILTER", "");
const STATUS_FILTER = optionalEnv("STATUS_FILTER", "");
const SYSTEM_ORDER = optionalEnv("SYSTEM_ORDER", "");
// How many systems start expanded from the top. 0 = all collapsed.
const COLLAPSE_AFTER = parseInt(optionalEnv("COLLAPSE_AFTER", "0"), 10);
// How long (seconds) to serve a cached response before re-fetching. 0 = disabled.
const CACHE_TTL = parseInt(optionalEnv("CACHE_TTL", "30"), 10);

// Supported icon category keys and their env var names
const ICON_KEYS = [
  "proxmox",
  "vm",
  "lxc",
  "rpi",
  "nas",
  "docker",
  "windows",
  "mac",
  "linux",
] as const;
type IconKey = (typeof ICON_KEYS)[number];

// Env-level icon assignments: ICON_PROXMOX=host1,host2  ICON_VM=host3 ...
const ICON_ENV: Partial<Record<IconKey, string>> = {};
for (const key of ICON_KEYS) {
  const val = optionalEnv(`ICON_${key.toUpperCase()}`, "");
  if (val) ICON_ENV[key] = val;
}

// Build a map of system-name (lowercase) → icon category key from comma-separated lists
function buildIconMap(
  overrides: Partial<Record<IconKey, string>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of ICON_KEYS) {
    const val = overrides[key];
    if (!val) continue;
    for (const name of val
      .split(",")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)) {
      map.set(name, key);
    }
  }
  return map;
}

// ---- Build PocketBase filter string ----

function buildFilter(
  systemFilter: string,
  statusFilter: string,
): string | undefined {
  const parts: string[] = [];

  if (systemFilter) {
    const names = systemFilter
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 1 && /[=~<>()&|]/.test(names[0])) {
      parts.push(`(${names[0]})`);
    } else {
      parts.push(`(${names.map((n) => `name="${n}"`).join(" || ")})`);
    }
  }

  if (statusFilter) parts.push(`status="${statusFilter}"`);
  return parts.length ? parts.join(" && ") : undefined;
}

// Pre-compute the env-level icon map and default filter once at startup.
// Per-request overrides (icon_* / systems= / status= query params) bypass these.
const ENV_ICON_MAP = buildIconMap(ICON_ENV);
const DEFAULT_FILTER = buildFilter(SYSTEM_FILTER, STATUS_FILTER);

// Tier function for default sort: non-up=0, up-bare=1, up-with-details=2
function tier(bnd: SystemBundle): number {
  if (bnd.system.status !== "up") return 0;
  return bnd.containers.length > 0 ||
    bnd.services.length > 0 ||
    bnd.smartDevices.length > 0
    ? 2
    : 1;
}

// ---- App ----

const app = express();
app.use(compression());
const client = new BeszelClient(beszelConfig);

// ---- Response cache (stale-while-revalidate) ----
// Cache keyed by the full request URL so different query-param combinations
// (systems=, status=, order=, icon_*) are cached independently.

interface CacheEntry {
  html: string;
  expiresAt: number; // epoch ms — when to start a background refresh
  refreshing: boolean; // true while a background fetch is in flight
}

const cache = new Map<string, CacheEntry>();

async function fetchWidget(
  filter: string | undefined,
  qOrder: string,
  qCollapseAfter: number,
  iconMap: Map<string, string>,
): Promise<string> {
  const t0 = Date.now();

  // Start alerts and system_details immediately — they have no dependencies.
  const alertsPromise = SHOW_ALERTS
    ? client.getAlerts(true)
    : Promise.resolve([]);
  const detailsPromise = client.getSystemDetails();

  // Fetch systems; once we have IDs collect the "up" ones and bulk-fetch all
  // their details in 3 requests total instead of 3×N requests.
  const systems = await client.getSystems(filter);
  const upIds = systems.filter((s) => s.status === "up").map((s) => s.id);

  // Fire bulk detail fetches + alerts + system_details all in parallel.
  const [containersMap, servicesMap, smartDevicesMap, alerts] =
    await Promise.all([
      client.getAllContainers(upIds),
      client.getAllServices(upIds),
      client.getAllSmartDevices(upIds),
      alertsPromise,
    ]);

  const detailsMap = await detailsPromise;

  const bundles: SystemBundle[] = systems.map(
    (system): SystemBundle => ({
      system,
      details: detailsMap.get(system.id),
      containers: containersMap.get(system.id) ?? [],
      services: servicesMap.get(system.id) ?? [],
      smartDevices: smartDevicesMap.get(system.id) ?? [],
    }),
  );

  const orderList = qOrder
    ? qOrder
        .split(",")
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean)
    : [];

  bundles.sort((a, b) => {
    if (orderList.length > 0) {
      const ai = orderList.indexOf(a.system.name.toLowerCase());
      const bi = orderList.indexOf(b.system.name.toLowerCase());
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.system.name.localeCompare(b.system.name);
    }
    const td = tier(a) - tier(b);
    if (td !== 0) return td;
    return a.system.name.localeCompare(b.system.name);
  });

  const opts: RenderOptions = {
    beszelUrl: WIDGET_TITLE_URL,
    showAlerts: SHOW_ALERTS,
    collapseAfter: qCollapseAfter,
    iconMap,
  };

  const html = renderWidget(bundles, alerts, opts);
  console.log(
    `[widget] fetch complete in ${Date.now() - t0}ms (${bundles.length} systems)`,
  );
  return html;
}

app.get("/beszel", async (req: Request, res: Response) => {
  try {
    const qSystems = req.query.systems as string | undefined;
    const qStatus = req.query.status as string | undefined;
    const qOrder = (req.query.order as string | undefined) ?? SYSTEM_ORDER;
    const qCollapseAfter =
      req.query.collapse_after !== undefined
        ? parseInt(req.query.collapse_after as string, 10)
        : COLLAPSE_AFTER;

    let iconMap = ENV_ICON_MAP;
    const hasIconOverrides = ICON_KEYS.some((k) => req.query[`icon_${k}`]);
    if (hasIconOverrides) {
      const reqIconOverrides: Partial<Record<IconKey, string>> = {
        ...ICON_ENV,
      };
      for (const key of ICON_KEYS) {
        const qval = req.query[`icon_${key}`] as string | undefined;
        if (qval) reqIconOverrides[key] = qval;
      }
      iconMap = buildIconMap(reqIconOverrides);
    }

    const filter =
      qSystems !== undefined || qStatus !== undefined
        ? buildFilter(qSystems ?? SYSTEM_FILTER, qStatus ?? STATUS_FILTER)
        : DEFAULT_FILTER;

    const cacheKey = req.url;
    const now = Date.now();
    const entry = cache.get(cacheKey);

    let html: string;

    if (entry && now < entry.expiresAt) {
      // Fully fresh — serve immediately
      html = entry.html;
    } else if (entry && !entry.refreshing) {
      // Stale — serve immediately and kick off a background refresh
      html = entry.html;
      entry.refreshing = true;
      fetchWidget(filter, qOrder, qCollapseAfter, iconMap)
        .then((fresh) => {
          cache.set(cacheKey, {
            html: fresh,
            expiresAt: Date.now() + CACHE_TTL * 1000,
            refreshing: false,
          });
        })
        .catch((err) => {
          console.error(
            "Background cache refresh failed:",
            err instanceof Error ? err.message : err,
          );
          entry.refreshing = false;
        });
    } else {
      // No cache entry (or refresh already in flight) — fetch synchronously
      html = await fetchWidget(filter, qOrder, qCollapseAfter, iconMap);
      if (CACHE_TTL > 0) {
        cache.set(cacheKey, {
          html,
          expiresAt: now + CACHE_TTL * 1000,
          refreshing: false,
        });
      }
    }

    res.setHeader("Widget-Title", WIDGET_TITLE);
    res.setHeader("Widget-Title-URL", WIDGET_TITLE_URL);
    res.setHeader("Widget-Content-Type", "html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      `public, max-age=${CACHE_TTL}, stale-while-revalidate=${CACHE_TTL * 2}`,
    );
    res.send(html);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Extension error:", message);

    res.setHeader("Widget-Title", WIDGET_TITLE);
    res.setHeader("Widget-Content-Type", "html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(
      `<p class="color-negative size-h5">&#9888; Beszel extension error</p>
       <p class="color-subdue size-h6">${escHtml(message)}</p>`,
    );
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ---- Copilot Extension ----

const copilotConfig: CopilotConfig | null = process.env.GH_TOKEN
  ? {
      token: requireEnv("GH_TOKEN"),
      username: requireEnv("GH_USERNAME"),
    }
  : null;

const COPILOT_WIDGET_TITLE = optionalEnv(
  "COPILOT_WIDGET_TITLE",
  "GitHub Copilot",
);
const COPILOT_CACHE_TTL = parseInt(optionalEnv("COPILOT_CACHE_TTL", "300"), 10);
const COPILOT_CREDITS = parseInt(optionalEnv("COPILOT_CREDITS", "1500"), 10);
const COPILOT_CREDIT_VALUE = parseFloat(
  optionalEnv("COPILOT_CREDIT_VALUE", "0.01"),
);

const copilotCache = new Map<string, { html: string; expiresAt: number }>();

let copilotClient: GitHubCopilotClient | null = null;
if (copilotConfig) {
  copilotClient = new GitHubCopilotClient(copilotConfig);
}

async function fetchCopilotHtml(url: string): Promise<string> {
  const cacheKey = url;
  const now = Date.now();
  const entry = copilotCache.get(cacheKey);
  if (entry && now < entry.expiresAt) return entry.html;

  const u = new URL(url, "http://localhost");
  const qYear = u.searchParams.get("year")
    ? parseInt(u.searchParams.get("year")!, 10)
    : undefined;
  const qMonth = u.searchParams.get("month")
    ? parseInt(u.searchParams.get("month")!, 10)
    : undefined;
  const qModel = u.searchParams.get("model") || undefined;
  const qProduct = u.searchParams.get("product") || undefined;

  const report = await copilotClient!.getAICreditUsage({
    year: qYear,
    month: qMonth,
    model: qModel,
    product: qProduct,
  });

  const opts: CopilotRenderOptions = {
    title: COPILOT_WIDGET_TITLE,
    titleUrl: `https://github.com/settings/billing`,
    totalCredits: COPILOT_CREDITS,
    creditValue: COPILOT_CREDIT_VALUE,
  };

  const html = renderCopilotWidget(report, opts);
  if (COPILOT_CACHE_TTL > 0) {
    copilotCache.set(cacheKey, {
      html,
      expiresAt: now + COPILOT_CACHE_TTL * 1000,
    });
  }
  return html;
}

if (copilotConfig) {
  app.get("/copilot", async (req: Request, res: Response) => {
    try {
      const html = await fetchCopilotHtml(req.url);
      res.setHeader("Widget-Title", COPILOT_WIDGET_TITLE);
      res.setHeader("Widget-Content-Type", "html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Copilot extension error:", message);
      res.setHeader("Widget-Title", COPILOT_WIDGET_TITLE);
      res.setHeader("Widget-Content-Type", "html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(500).send(
        `<p class="color-negative size-h5">&#9888; Copilot extension error</p>
       <p class="color-subdue size-h6">${escHtml(message)}</p>`,
      );
    }
  });
}

// ---- OpenRouter Extension ----

const openRouterConfig = process.env.OPENROUTER_API_KEY
  ? { apiKey: requireEnv("OPENROUTER_API_KEY") }
  : null;

const OPENROUTER_WIDGET_TITLE = optionalEnv(
  "OPENROUTER_WIDGET_TITLE",
  "OpenRouter Credits",
);
const OPENROUTER_CACHE_TTL = parseInt(
  optionalEnv("OPENROUTER_CACHE_TTL", "300"),
  10,
);

const openRouterCache = new Map<string, { html: string; expiresAt: number }>();

let openRouterClient: OpenRouterClient | null = null;
if (openRouterConfig) {
  openRouterClient = new OpenRouterClient(openRouterConfig);
}

async function fetchOpenRouterHtml(): Promise<string> {
  const cacheKey = "/openrouter";
  const now = Date.now();
  const entry = openRouterCache.get(cacheKey);
  if (entry && now < entry.expiresAt) return entry.html;

  const keyData = await openRouterClient!.getCredits();
  const opts: OpenRouterRenderOptions = { title: OPENROUTER_WIDGET_TITLE };
  const html = renderOpenRouterWidget(keyData, opts);
  if (OPENROUTER_CACHE_TTL > 0) {
    openRouterCache.set(cacheKey, {
      html,
      expiresAt: now + OPENROUTER_CACHE_TTL * 1000,
    });
  }
  return html;
}

if (openRouterConfig) {
  app.get("/openrouter", async (_req: Request, res: Response) => {
    try {
      const html = await fetchOpenRouterHtml();
      res.setHeader("Widget-Title", OPENROUTER_WIDGET_TITLE);
      res.setHeader("Widget-Content-Type", "html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("OpenRouter extension error:", message);
      res.setHeader("Widget-Title", OPENROUTER_WIDGET_TITLE);
      res.setHeader("Widget-Content-Type", "html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(500).send(
        `<p class="color-negative size-h5">&#9888; OpenRouter extension error</p>
       <p class="color-subdue size-h6">${escHtml(message)}</p>`,
      );
    }
  });
}

// ---- Combined AI Credits Route ----
// ?source=copilot  → only Copilot
// ?source=openrouter → only OpenRouter
// ?source=all or omitted → all configured sources

app.get("/ai-credits", async (req: Request, res: Response) => {
  try {
    const source = ((req.query.source as string) || "all").toLowerCase();
    const parts: string[] = [];

    const divider = `<div style="height:1px;background:var(--color-widget-border,#777);margin:12px 0"></div>`;

    if ((source === "all" || source === "copilot") && copilotConfig) {
      parts.push(await fetchCopilotHtml("/copilot"));
    }
    if ((source === "all" || source === "openrouter") && openRouterConfig) {
      parts.push(await fetchOpenRouterHtml());
    }

    if (parts.length === 0) {
      const hints: string[] = [];
      if (!copilotConfig) hints.push("GH_TOKEN+GH_USERNAME");
      if (!openRouterConfig) hints.push("OPENROUTER_API_KEY");
      res.setHeader("Widget-Title", "AI Credits");
      res.setHeader("Widget-Content-Type", "html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        `<p class="color-negative size-h5">&#9888; No AI credit sources configured</p>
       <p class="color-subdue size-h6">Set ${hints.join(" or ")} to enable.</p>`,
      );
      return;
    }

    res.setHeader("Widget-Title", "AI Credits");
    res.setHeader("Widget-Content-Type", "html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      `<div style="display:flex;flex-direction:column;gap:8px">${parts.join(divider)}</div>`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("AI credits error:", message);
    res.setHeader("Widget-Title", "AI Credits");
    res.setHeader("Widget-Content-Type", "html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(
      `<p class="color-negative size-h5">&#9888; AI credits error</p>
     <p class="color-subdue size-h6">${escHtml(message)}</p>`,
    );
  }
});

app.listen(PORT, () => {
  console.log(`Glance extensions running on port ${PORT}`);
  console.log(`  Beszel URL:   ${beszelConfig.url}`);
  console.log(`  Widget title: ${WIDGET_TITLE}`);
  console.log(`  Show alerts:  ${SHOW_ALERTS}`);
  console.log(`  Cache TTL:    ${CACHE_TTL}s`);
  if (SYSTEM_FILTER) console.log(`  System filter: ${SYSTEM_FILTER}`);
  if (STATUS_FILTER) console.log(`  Status filter: ${STATUS_FILTER}`);
  if (SYSTEM_ORDER) console.log(`  System order:  ${SYSTEM_ORDER}`);
  if (copilotConfig) {
    console.log(`  Copilot user: ${copilotConfig.username}`);
  } else {
    console.log(`  Copilot:      disabled (set GH_TOKEN and GH_USERNAME)`);
  }
  if (openRouterConfig) {
    console.log(`  OpenRouter:   enabled`);
  } else {
    console.log(`  OpenRouter:   disabled (set OPENROUTER_API_KEY)`);
  }
});

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
