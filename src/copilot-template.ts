import path from "path";
import fs from "fs";
import ejs from "ejs";
import * as lucide from "lucide";
import * as si from "simple-icons";
import { PremiumRequestUsageReport } from "./copilot";
import { SvgRegistry } from "./template";

export interface CopilotRenderOptions {
  title: string;
  titleUrl?: string;
  totalCredits?: number;
  creditValue?: number;
}

const TEMPLATES_DIR = path.resolve(__dirname, "../templates");
const WIDGET_TEMPLATE = fs.readFileSync(
  path.join(TEMPLATES_DIR, "copilot.ejs"),
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
  const siCopilot = (si as Record<string, { path: string; hex: string }>)
    .siGithubcopilot;
  const icons = {
    Copilot: simpleIcon(siCopilot, "16", "currentColor"),
    Sparkles: lucideIcon("Sparkles", m),
    Brain: lucideIcon("Brain", s),
    Bot: lucideIcon("Bot", s),
    Cpu: lucideIcon("Cpu", s),
    DollarSign: lucideIcon("DollarSign", s),
    BarChart3: lucideIcon("BarChart3", s),
    ChevronRight: lucideIcon("ChevronRight", s),
    ChevronDown: lucideIcon("ChevronDown", { width: "14", height: "14" }),
    RefreshCw: lucideIcon("RefreshCw", m),
    Calendar: lucideIcon("Calendar", m),
    TrendingUp: lucideIcon("TrendingUp", m),
  };
  return Object.fromEntries(
    Object.entries(icons).map(([k, v]) => [k, reg.use(v)]),
  ) as typeof icons;
}

export const DEFAULT_TOTAL_CREDITS = 1500;
export const DEFAULT_CREDIT_VALUE = 0.01;

export function renderCopilotWidget(
  report: PremiumRequestUsageReport,
  opts: CopilotRenderOptions,
): string {
  const reg = new SvgRegistry("cp");
  const icons = buildIcons(reg);

  const totalCredits = opts.totalCredits ?? DEFAULT_TOTAL_CREDITS;
  const creditValue = opts.creditValue ?? DEFAULT_CREDIT_VALUE;
  const totalAllowance = totalCredits * creditValue;

  const totalGrossQty = report.usageItems.reduce(
    (s, i) => s + i.grossQuantity,
    0,
  );
  const totalGrossAmount = report.usageItems.reduce(
    (s, i) => s + i.grossAmount,
    0,
  );
  const usedCredits = Math.round(totalGrossQty);
  const remainingCredits = Math.max(0, totalCredits - usedCredits);
  const usagePercent = Math.min(
    100,
    Math.round((usedCredits / totalCredits) * 100),
  );

  // Per-model usage using gross values
  const modelUsage = report.usageItems
    .filter((i) => i.grossQuantity > 0)
    .map((i) => ({
      model: i.model,
      sku: i.sku,
      requests: i.grossQuantity,
      cost: i.grossAmount,
    }));

  return ejs.render(
    WIDGET_TEMPLATE,
    {
      report,
      icons,
      svgDefs: () => reg.defsHtml(),
      title: opts.title,
      titleUrl: opts.titleUrl,
      totalGrossQty,
      totalGrossAmount,
      usedCredits,
      remainingCredits,
      usagePercent,
      totalCredits,
      totalAllowance,
      modelUsage,
      modelIcons: {
        "gpt-4o": "Sparkles",
        "gpt-4": "Brain",
        claude: "Bot",
        o1: "Cpu",
        o3: "Cpu",
      } as Record<string, string>,
    },
    {
      filename: path.join(TEMPLATES_DIR, "copilot.ejs"),
      cache: true,
    },
  );
}
