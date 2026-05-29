import path from "path";
import ejs from "ejs";
import {
  SystemRecord,
  AlertRecord,
  ContainerRecord,
  ServiceRecord,
  SmartDeviceRecord,
} from "./beszel";

// ---- Bundle type ----

export interface SystemBundle {
  system: SystemRecord;
  containers: ContainerRecord[];
  services: ServiceRecord[];
  smartDevices: SmartDeviceRecord[];
}

export interface RenderOptions {
  beszelUrl: string;
  showAlerts: boolean;
  /** How many systems (top of sorted list) start expanded. 0 = all collapsed (default). */
  collapseAfter: number;
}

const TEMPLATES_DIR = path.resolve(__dirname, "../templates");

// ---- Main render ----

export function renderWidget(
  bundles: SystemBundle[],
  alerts: AlertRecord[],
  opts: RenderOptions,
): string {
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  return ejs.render(
    // Read the template synchronously at render time (EJS caches internally when cache:true)
    require("fs").readFileSync(path.join(TEMPLATES_DIR, "widget.ejs"), "utf8"),
    {
      bundles,
      triggeredAlerts,
      showAlerts: opts.showAlerts,
      beszelUrl: opts.beszelUrl,
      collapseAfter: opts.collapseAfter,
    },
    {
      filename: path.join(TEMPLATES_DIR, "widget.ejs"), // needed for include() resolution
      cache: true,
    },
  );
}
