import path from "path";
import ejs from "ejs";
import * as lucide from "lucide";
import * as si from "simple-icons";
import {
  SystemRecord,
  SystemDetailsRecord,
  AlertRecord,
  ContainerRecord,
  ServiceRecord,
  SmartDeviceRecord,
} from "./beszel";

// ---- Bundle type ----

export interface SystemBundle {
  system: SystemRecord;
  details: SystemDetailsRecord | undefined;
  containers: ContainerRecord[];
  services: ServiceRecord[];
  smartDevices: SmartDeviceRecord[];
}

export interface RenderOptions {
  beszelUrl: string;
  showAlerts: boolean;
  collapseAfter: number;
  iconMap: Map<string, string>;  // system name (lower) → category key
}

const TEMPLATES_DIR = path.resolve(__dirname, "../templates");

// ---- Lucide icon helper ----
// Converts lucide icon data ([tag, attrs][] tuples) into an SVG string.
// Extra attrs are merged onto the root <svg> element (e.g. size, class, style).

type LucideIconNode = [string, Record<string, string>];
type LucideIconData = LucideIconNode[];

function lucideIcon(
  name: keyof typeof lucide,
  extraAttrs: Record<string, string> = {},
): string {
  const data = (lucide as Record<string, unknown>)[name] as
    | LucideIconData
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

// Build an SVG from a simple-icons icon using the brand hex color.
// Fill is set on both the <svg> and the <path> to survive any CSS resets from the host page.
function simpleIcon(
  icon: { path: string; hex: string },
  size = "18",
  overrideHex?: string,
): string {
  const color = `#${overrideHex ?? icon.hex}`;
  const attrs: Record<string, string> = {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: color,
    style: `flex-shrink:0;fill:${color}`,
  };
  const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
  return `<svg ${attrStr}><path fill="${color}" d="${icon.path}"/></svg>`;
}

// Special two-color Proxmox icon:
// subpaths 0 + 2 = orange chevrons, subpath 1 = vertical wings (white on dark bg).
function proxmoxIcon(size = "18"): string {
  const pxsi = (si as Record<string, { path: string; hex: string }>).siProxmox;
  const subpaths = pxsi.path.match(/M[^M]*/g) ?? [];
  // subpath 1 contains both wings joined by "zm" — keep as-is, just recolor
  const orange = "#E57000";
  const wing   = "#C0C0C0"; // light grey — visible on both dark and light backgrounds
  const svgAttrs = `xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" style="flex-shrink:0"`;
  const paths = subpaths.map((d, i) => {
    // subpath 1 = left+right vertical wings (orange), subpaths 0+2 = top/bottom chevrons (grey)
    const color = i === 1 ? orange : wing;
    return `<path fill="${color}" d="${d.trimEnd()}"/>`;
  }).join("");
  return `<svg ${svgAttrs}>${paths}</svg>`;
}

// Returns an OS/distro icon SVG based on os_name string.
export function osIcon(osName: string, osType: number): string {
  const n = (osName || "").toLowerCase();
  const get = (k: string) => (si as Record<string, { path: string; hex: string }>)[k];

  if (osType === 1 || n.includes("macos") || n.includes("darwin")) return simpleIcon(get("siApple"), "18", "C0C0C0");
  if (n.includes("debian"))   return simpleIcon(get("siDebian"));
  if (n.includes("ubuntu"))   return simpleIcon(get("siUbuntu"));
  if (n.includes("alpine"))   return simpleIcon(get("siAlpinelinux"));
  if (n.includes("fedora"))   return simpleIcon(get("siFedora"));
  if (n.includes("centos"))   return simpleIcon(get("siCentos"));
  if (n.includes("red hat") || n.includes("rhel")) return simpleIcon(get("siRedhat"));
  if (n.includes("arch"))     return simpleIcon(get("siArchlinux"));
  if (n.includes("opensuse") || n.includes("suse")) return simpleIcon(get("siOpensuse"));
  if (n.includes("nixos"))    return simpleIcon(get("siNixos"));
  if (n.includes("gentoo"))   return simpleIcon(get("siGentoo"));
  if (n.includes("freebsd"))  return simpleIcon(get("siFreebsd"));
  if (n.includes("raspbian") || n.includes("raspberry")) return simpleIcon(get("siRaspberrypi"));
  if (n.includes("proxmox"))  return proxmoxIcon();
  if (osType === 0 || n.includes("linux")) return simpleIcon(get("siLinux"));

  return lucideIcon("Monitor", { width: "18", height: "18" });
}

// Named category icons that can be assigned to systems via ICON_<key> env / query param.
// simpleIcon() uses the brand hex by default; only Apple is overridden (brand = #000000, invisible on dark).
// LXC brand is #333333 (near-black) so also falls back to currentColor via lucide-style stroke icon alternative.
const CATEGORY_ICONS: Record<string, () => string> = {
  proxmox: () => proxmoxIcon(),
  vm:      () => lucideIcon("Server",    { width: "18", height: "18", style: "flex-shrink:0" }),
  lxc:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinuxcontainers),
  rpi:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siRaspberrypi),
  nas:     () => lucideIcon("HardDrive", { width: "18", height: "18", style: "flex-shrink:0" }),
  docker:  () => simpleIcon((si as Record<string, { path: string; hex: string }>).siDocker),
  windows: () => simpleIcon((si as Record<string, { path: string; hex: string }>).siWindows),
  mac:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siApple, "18", "C0C0C0"),
  linux:   () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinux),
};

// Resolve the icon for a system: check iconMap override first, then fall back to OS detection.
export function resolveSystemIcon(
  systemName: string,
  details: { os_name: string; os: number } | undefined,
  iconMap: Map<string, string>,   // system name (lower) → category key
): string {
  const key = iconMap.get(systemName.toLowerCase());
  if (key && CATEGORY_ICONS[key]) return CATEGORY_ICONS[key]();
  if (details) return osIcon(details.os_name, details.os);
  return lucideIcon("Server", { width: "18", height: "18", style: "flex-shrink:0" });
}

// Pre-build all icons used in templates so EJS just calls icons.Server etc.
function buildIcons() {
  const os  = { width: "18", height: "18", style: "flex-shrink:0" }; // system-level icons (OS / status)
  const sm  = { width: "14", height: "14" };                          // small inline icons
  return {
    // system status fallbacks (used when no details available)
    Server:      lucideIcon("Computer",    os),
    CircleX:     lucideIcon("CircleX",     os),
    CirclePause: lucideIcon("CirclePause", os),
    // expand arrow
    ChevronRight: lucideIcon("ChevronRight", {
      width: "14", height: "14",
      class: "details-arrow",
      style: "transition:transform .15s;flex-shrink:0;margin-right:2px",
    }),
    // section headers
    Box:       lucideIcon("Box",       sm),
    Settings2: lucideIcon("Settings2", sm),
    HardDrive: lucideIcon("HardDrive", sm),
    // alert
    TriangleAlert: lucideIcon("TriangleAlert", { width: "18", height: "18" }),
    // stat bar icons
    Cpu:         lucideIcon("Cpu",         sm),
    MemoryStick: lucideIcon("MemoryStick", sm),
    Database:    lucideIcon("Database",    sm),
    // status indicators (containers, services, disks)
    CircleCheck:  lucideIcon("CircleCheck",  sm),
    CircleMinus:  lucideIcon("CircleMinus",  sm),
    CircleDot:    lucideIcon("CircleDot",    sm),
  };
}

const ICONS = buildIcons();

// ---- Main render ----

export function renderWidget(
  bundles: SystemBundle[],
  alerts: AlertRecord[],
  opts: RenderOptions,
): string {
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  return ejs.render(
    require("fs").readFileSync(path.join(TEMPLATES_DIR, "widget.ejs"), "utf8"),
    {
      bundles,
      triggeredAlerts,
      showAlerts: opts.showAlerts,
      beszelUrl: opts.beszelUrl,
      collapseAfter: opts.collapseAfter,
      icons: ICONS,
      osIcon,
      resolveSystemIcon: (name: string, details: { os_name: string; os: number } | undefined) =>
        resolveSystemIcon(name, details, opts.iconMap),
    },
    {
      filename: path.join(TEMPLATES_DIR, "widget.ejs"),
      cache: true,
    },
  );
}
