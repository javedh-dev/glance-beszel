import "dotenv/config";
import express, { Request, Response } from "express";
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
const WIDGET_TITLE = optionalEnv("WIDGET_TITLE", "Homelab");
const WIDGET_TITLE_URL = optionalEnv("WIDGET_TITLE_URL", beszelConfig.url);
const SHOW_ALERTS = optionalEnv("SHOW_ALERTS", "true") === "true";
const SYSTEM_FILTER = optionalEnv("SYSTEM_FILTER", "");
const STATUS_FILTER = optionalEnv("STATUS_FILTER", "");
// How many systems (from the top of the sorted list) start expanded. 0 = all collapsed.
const COLLAPSE_AFTER = parseInt(optionalEnv("COLLAPSE_AFTER", "0"), 10);

// ---- Build effective filter ----

function buildFilter(systemFilter: string, statusFilter: string): string | undefined {
  const parts: string[] = [];

  // systemFilter: comma-separated names → name="a" || name="b" || ...
  // Falls back to raw PocketBase expression if no commas and contains operators
  if (systemFilter) {
    const names = systemFilter.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length === 1 && /[=~<>()&|]/.test(names[0])) {
      parts.push(`(${names[0]})`);
    } else {
      parts.push(`(${names.map((n) => `name="${n}"`).join(" || ")})`);
    }
  }

  if (statusFilter) parts.push(`status="${statusFilter}"`);
  return parts.length ? parts.join(" && ") : undefined;
}

// ---- App ----

const app = express();
const client = new BeszelClient(beszelConfig);

app.get("/", async (req: Request, res: Response) => {
  try {
    // Query params override env defaults, allowing per-widget config in Glance:
    //   url: http://localhost:8088/?systems=pbs,nexus&status=up&collapse_after=3
    const qSystems      = (req.query.systems       as string | undefined) ?? SYSTEM_FILTER;
    const qStatus       = (req.query.status        as string | undefined) ?? STATUS_FILTER;
    const qCollapseAfter = req.query.collapse_after !== undefined
      ? parseInt(req.query.collapse_after as string, 10)
      : COLLAPSE_AFTER;

    const filter = buildFilter(qSystems, qStatus);
    const [systems, alerts] = await Promise.all([
      client.getSystems(filter),
      SHOW_ALERTS ? client.getAlerts() : Promise.resolve([]),
    ]);

    // Fetch per-system detail data in parallel
    const bundles: SystemBundle[] = await Promise.all(
      systems.map(async (system): Promise<SystemBundle> => {
        if (system.status !== "up") {
          return { system, containers: [], services: [], smartDevices: [] };
        }
        const [containers, services, smartDevices] = await Promise.all([
          client.getContainersForSystem(system.id),
          client.getServicesForSystem(system.id),
          client.getSmartDevicesForSystem(system.id),
        ]);
        return { system, containers, services, smartDevices };
      }),
    );

    // Sort: errored (down/paused) → no nested detail → has nested detail
    // Within each tier: alphabetical by name
    function sortTier(b: SystemBundle): number {
      if (b.system.status !== "up") return 0;
      const hasDetails = b.containers.length > 0 || b.services.length > 0 || b.smartDevices.length > 0;
      return hasDetails ? 2 : 1;
    }
    bundles.sort((a, b) => {
      const td = sortTier(a) - sortTier(b);
      if (td !== 0) return td;
      return a.system.name.localeCompare(b.system.name);
    });

    const opts: RenderOptions = {
      beszelUrl: WIDGET_TITLE_URL,
      showAlerts: SHOW_ALERTS,
      collapseAfter: qCollapseAfter,
    };

    const html = renderWidget(bundles, alerts, opts);

    res.setHeader("Widget-Title", WIDGET_TITLE);
    res.setHeader("Widget-Title-URL", WIDGET_TITLE_URL);
    res.setHeader("Widget-Content-Type", "html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
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
  if (SYSTEM_FILTER) console.log(`  System filter: ${SYSTEM_FILTER}`);
  if (STATUS_FILTER) console.log(`  Status filter: ${STATUS_FILTER}`);
});

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
