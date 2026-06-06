import path from "path";
import fs from "fs";
import ejs from "ejs";
import * as lucide from "lucide";
import * as si from "simple-icons";
import { OpenRouterCredits } from "./openrouter";
import { SvgRegistry } from "./template";

export interface OpenRouterRenderOptions {
  title: string;
  titleUrl?: string;
}

const TEMPLATES_DIR = path.resolve(__dirname, "../templates");
const WIDGET_TEMPLATE = fs.readFileSync(
  path.join(TEMPLATES_DIR, "openrouter.ejs"),
  "utf8",
);

function lucideIcon(
  name: keyof typeof lucide,
  extraAttrs: Record<string, string> = {},
): string {
  const data = (lucide as Record<string, unknown>)[name] as
    | [string, Record<string, string>][]
    | undefined;
  if (!data || !Array.isArray(data)) return "";

  const svgAttrs: Record<string, string> = {
    xmlns: "http://www.w3.org/2000/svg",
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...extraAttrs,
  };

  const attrStr = Object.entries(svgAttrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

  const children = data
    .map(([tag, attrs]) => {
      const childAttrs = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${childAttrs}/>`;
    })
    .join("");

  return `<svg ${attrStr}>${children}</svg>`;
}

function simpleIcon(
  icon: { path: string; hex: string },
  size = "16",
  overrideHex?: string,
): string {
  const color =
    overrideHex === "currentColor"
      ? "currentColor"
      : `#${overrideHex ?? icon.hex}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" style="flex-shrink:0"><path fill="${color}" d="${icon.path}"/></svg>`;
}

function buildIcons(reg: SvgRegistry) {
  const s = { width: "16", height: "16", style: "flex-shrink:0" };
  const m = { width: "14", height: "14" };
  const siOr = (si as Record<string, { path: string; hex: string }>)
    .siOpenrouter;
  const icons = {
    OpenRouter: simpleIcon(siOr, "16"),
    DollarSign: lucideIcon("Coins", m),
    TrendingUp: lucideIcon("TrendingUp", m),
  };
  return Object.fromEntries(
    Object.entries(icons).map(([k, v]) => [k, reg.use(v)]),
  ) as typeof icons;
}

export function renderOpenRouterWidget(
  credits: OpenRouterCredits,
  opts: OpenRouterRenderOptions,
): string {
  const reg = new SvgRegistry("or");
  const icons = buildIcons(reg);
  const hasCredits = credits.limit > 0;
  const usagePercent = hasCredits
    ? Math.min(100, Math.round((credits.usage / credits.limit) * 100))
    : 0;

  return ejs.render(
    WIDGET_TEMPLATE,
    {
      icons,
      svgDefs: () => reg.defsHtml(),
      title: opts.title,
      titleUrl: opts.titleUrl,
      usage: credits.usage,
      limit: credits.limit,
      remaining: credits.remaining,
      usagePercent,
      isFree: credits.isFree,
      keyLabel: credits.label,
    },
    {
      filename: path.join(TEMPLATES_DIR, "openrouter.ejs"),
      cache: true,
    },
  );
}
