import "dotenv/config";
import express, { Request, Response } from "express";
import compression from "compression";
import { BeszelClient, BeszelConfig } from "./beszel";
import { renderWidget, RenderOptions, SystemBundle } from "./template";

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
  expiresAt: number;    // epoch ms — when to start a background refresh
  refreshing: boolean;  // true while a background fetch is in flight
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
  const alertsPromise = SHOW_ALERTS ? client.getAlerts(true) : Promise.resolve([]);
  const detailsPromise = client.getSystemDetails();

  // Fetch systems; as soon as we have IDs, fire all per-system calls in parallel
  // without waiting for alerts/details to finish.
  const systems = await client.getSystems(filter);

  const bundlePromises = systems.map(async (system): Promise<SystemBundle> => {
    const details = detailsPromise.then((m) => m.get(system.id));
    if (system.status !== "up") {
      return { system, details: await details, containers: [], services: [], smartDevices: [] };
    }
    const [resolvedDetails, containers, services, smartDevices] = await Promise.all([
      details,
      client.getContainersForSystem(system.id),
      client.getServicesForSystem(system.id),
      client.getSmartDevicesForSystem(system.id),
    ]);
    return { system, details: resolvedDetails, containers, services, smartDevices };
  });

  // Wait for everything to settle
  const [bundles, alerts] = await Promise.all([
    Promise.all(bundlePromises),
    alertsPromise,
  ]);

  const orderList = qOrder
    ? qOrder.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean)
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
  console.log(`[widget] fetch complete in ${Date.now() - t0}ms (${bundles.length} systems)`);
  return html;
}

app.get("/", async (req: Request, res: Response) => {
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
      const reqIconOverrides: Partial<Record<IconKey, string>> = { ...ICON_ENV };
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
          console.error("Background cache refresh failed:", err instanceof Error ? err.message : err);
          entry.refreshing = false;
        });
    } else {
      // No cache entry (or refresh already in flight) — fetch synchronously
      html = await fetchWidget(filter, qOrder, qCollapseAfter, iconMap);
      if (CACHE_TTL > 0) {
        cache.set(cacheKey, { html, expiresAt: now + CACHE_TTL * 1000, refreshing: false });
      }
    }

    res.setHeader("Widget-Title", WIDGET_TITLE);
    res.setHeader("Widget-Title-URL", WIDGET_TITLE_URL);
    res.setHeader("Widget-Content-Type", "html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL}, stale-while-revalidate=${CACHE_TTL * 2}`);
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

app.listen(PORT, () => {
  console.log(`Glance Beszel extension running on port ${PORT}`);
  console.log(`  Beszel URL:   ${beszelConfig.url}`);
  console.log(`  Widget title: ${WIDGET_TITLE}`);
  console.log(`  Show alerts:  ${SHOW_ALERTS}`);
  console.log(`  Cache TTL:    ${CACHE_TTL}s`);
  if (SYSTEM_FILTER) console.log(`  System filter: ${SYSTEM_FILTER}`);
  if (STATUS_FILTER) console.log(`  Status filter: ${STATUS_FILTER}`);
  if (SYSTEM_ORDER) console.log(`  System order:  ${SYSTEM_ORDER}`);
});

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
