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

import fs from "fs";

const TEMPLATES_DIR = path.resolve(__dirname, "../templates");

// Pre-read the root template once at startup — avoids synchronous disk I/O on every request.
const WIDGET_TEMPLATE = fs.readFileSync(
  path.join(TEMPLATES_DIR, "widget.ejs"),
  "utf8",
);

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
// Pass overrideHex="currentColor" to use the CSS foreground color instead of the brand color.
function simpleIcon(
  icon: { path: string; hex: string },
  size = "18",
  overrideHex?: string,
): string {
  const color = overrideHex === "currentColor" ? "currentColor" : `#${overrideHex ?? icon.hex}`;
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

// Returns the base OS icon (generic platform) and an optional distro badge icon.
// Base: Linux tux, Apple, Windows, or Monitor fallback.
// Badge: specific distro (Debian, Ubuntu, etc.) — null if no specific distro known.
export function osIconParts(
  osName: string,
  osType: number,
): { base: string; badge: string | null } {
  const n = (osName || "").toLowerCase();
  const get = (k: string) => (si as Record<string, { path: string; hex: string }>)[k];
  const badge = (k: string) => simpleIcon(get(k), "12");

  if (osType === 1 || n.includes("macos") || n.includes("darwin"))
    return { base: simpleIcon(get("siApple"), "18", "C0C0C0"), badge: null };

  if (n.includes("proxmox"))
    return { base: proxmoxIcon(), badge: null };

  if (n.includes("raspbian") || n.includes("raspberry"))
    return { base: simpleIcon(get("siRaspberrypi")), badge: null };

  if (n.includes("freebsd"))
    return { base: simpleIcon(get("siFreebsd")), badge: null };

  // Generic Linux base (currentColor) + distro badge
  const linuxBase = simpleIcon(get("siLinux"), "18", "currentColor");
  if (n.includes("debian"))   return { base: linuxBase, badge: badge("siDebian") };
  if (n.includes("ubuntu"))   return { base: linuxBase, badge: badge("siUbuntu") };
  if (n.includes("alpine"))   return { base: linuxBase, badge: badge("siAlpinelinux") };
  if (n.includes("fedora"))   return { base: linuxBase, badge: badge("siFedora") };
  if (n.includes("centos"))   return { base: linuxBase, badge: badge("siCentos") };
  if (n.includes("red hat") || n.includes("rhel")) return { base: linuxBase, badge: badge("siRedhat") };
  if (n.includes("arch"))     return { base: linuxBase, badge: badge("siArchlinux") };
  if (n.includes("opensuse") || n.includes("suse")) return { base: linuxBase, badge: badge("siOpensuse") };
  if (n.includes("nixos"))    return { base: linuxBase, badge: badge("siNixos") };
  if (n.includes("gentoo"))   return { base: linuxBase, badge: badge("siGentoo") };
  if (osType === 0 || n.includes("linux")) return { base: linuxBase, badge: null };

  return { base: lucideIcon("Monitor", { width: "18", height: "18" }), badge: null };
}

// Legacy single-icon helper (kept for any external callers).
export function osIcon(osName: string, osType: number): string {
  return osIconParts(osName, osType).base;
}

// Named category badge icons (12px) — shown as overlay on top of the base OS icon.
// These are the manual overrides assigned via ICON_<key> env / query param.
const CATEGORY_BADGE_ICONS: Record<string, () => string> = {
  proxmox: () => proxmoxIcon("12"),
  vm:      () => lucideIcon("Server",    { width: "12", height: "12", style: "flex-shrink:0" }),
  lxc:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinuxcontainers, "12"),
  rpi:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siRaspberrypi, "12"),
  nas:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siOpenmediavault, "12"),
  docker:  () => simpleIcon((si as Record<string, { path: string; hex: string }>).siDocker, "12"),
  windows: () => simpleIcon((si as Record<string, { path: string; hex: string }>).siWindows, "12"),
  mac:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siApple, "12", "C0C0C0"),
  linux:   () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinux, "12", "currentColor"),
};

// Fallback base icons when no OS details are available for a given category.
const CATEGORY_FALLBACK_BASE: Record<string, () => string> = {
  proxmox: () => proxmoxIcon(),
  vm:      () => lucideIcon("Server",    { width: "18", height: "18", style: "flex-shrink:0" }),
  lxc:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinux),
  rpi:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siRaspberrypi),
  nas:     () => lucideIcon("HardDrive", { width: "18", height: "18", style: "flex-shrink:0" }),
  docker:  () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinux),
  windows: () => simpleIcon((si as Record<string, { path: string; hex: string }>).siWindows),
  mac:     () => simpleIcon((si as Record<string, { path: string; hex: string }>).siApple, "18", "C0C0C0"),
  linux:   () => simpleIcon((si as Record<string, { path: string; hex: string }>).siLinux),
};

// Resolve the icon parts (base + optional badge) for a system.
// Category overrides (ICON_<key>) become the badge; the base always comes from OS detection.
// If no details are available, the category fallback base is used instead.
export function resolveSystemIconParts(
  systemName: string,
  details: { os_name: string; os: number } | undefined,
  iconMap: Map<string, string>,
): { base: string; badge: string | null } {
  const key = iconMap.get(systemName.toLowerCase());
  if (key && CATEGORY_BADGE_ICONS[key]) {
    const base = details
      ? osIconParts(details.os_name, details.os).base
      : (CATEGORY_FALLBACK_BASE[key]?.() ?? lucideIcon("Server", { width: "18", height: "18", style: "flex-shrink:0" }));
    const badge = CATEGORY_BADGE_ICONS[key]();
    return { base, badge };
  }
  if (details) return osIconParts(details.os_name, details.os);
  return { base: lucideIcon("Server", { width: "18", height: "18", style: "flex-shrink:0" }), badge: null };
}

// Resolve the icon for a system: check iconMap override first, then fall back to OS detection.
export function resolveSystemIcon(
  systemName: string,
  details: { os_name: string; os: number } | undefined,
  iconMap: Map<string, string>,
): string {
  return resolveSystemIconParts(systemName, details, iconMap).base;
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
    // chevron-slot status icons for down/paused rows (same 14px slot as ChevronRight)
    CircleXSlot:     lucideIcon("CircleX",     { width: "14", height: "14", style: "flex-shrink:0" }),
    CirclePauseSlot: lucideIcon("CirclePause", { width: "14", height: "14", style: "flex-shrink:0" }),
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
  return ejs.render(
    WIDGET_TEMPLATE,
    {
      bundles,
      triggeredAlerts: alerts,
      showAlerts: opts.showAlerts,
      beszelUrl: opts.beszelUrl,
      collapseAfter: opts.collapseAfter,
      icons: ICONS,
      osIcon,
      resolveSystemIcon: (name: string, details: { os_name: string; os: number } | undefined) =>
        resolveSystemIcon(name, details, opts.iconMap),
      resolveSystemIconParts: (name: string, details: { os_name: string; os: number } | undefined) =>
        resolveSystemIconParts(name, details, opts.iconMap),
    },
    {
      filename: path.join(TEMPLATES_DIR, "widget.ejs"),
      cache: true,
    },
  );
}
