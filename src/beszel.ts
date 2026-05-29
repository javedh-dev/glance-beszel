export interface BeszelConfig {
  url: string;
  email: string;
  password: string;
}

export interface SystemRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  status: "up" | "down" | "paused";
  info: SystemInfo;
  updated: string;
}

// system.Info struct — what's stored in systems.info JSON column
export interface SystemInfo {
  cpu: number;       // CPU usage %
  mp: number;        // memory used %
  dp: number;        // disk used %
  mu: number;        // memory used bytes (legacy)
  m: number;         // memory total bytes (legacy)
  du: number;        // disk used bytes (legacy)
  d: number;         // disk total bytes (legacy)
  bb: number;        // bandwidth bytes (sent+recv total)
  bs?: number;       // legacy bandwidth sent bytes/s
  br?: number;       // legacy bandwidth recv bytes/s
  b?: number;        // legacy bandwidth MB/s
  t?: number;        // uptime seconds (legacy field name in older agents)
  u?: number;        // uptime seconds (new field name)
  k?: string;        // kernel version (deprecated, moved to system_details)
  v: string;         // agent version
  la?: [number, number, number]; // load average [1m, 5m, 15m]
  sv?: [number, number];         // services [total, failed]
  g?: number;        // GPU usage %
  dt?: number;       // dashboard temperature
}

export interface AlertRecord {
  id: string;
  name: string;
  system: string;
  triggered: boolean;
  updated: string;
}

// containers collection record
// memory is stored in MB (float64 from container.Mem)
export interface ContainerRecord {
  id: string;
  system: string;
  name: string;
  image: string;
  ports: string;
  status: string;
  health: number; // 0=none, 1=starting, 2=healthy, 3=unhealthy
  cpu: number;    // %
  memory: number; // MB (float64)
  net: number;    // total bandwidth bytes
  updated: string;
}

// systemd_services collection record
// state and sub are stored as integer enums (uint8) in PocketBase:
//   state: 0=active, 1=inactive, 2=failed, 3=activating, 4=deactivating, 5=reloading
//   sub:   0=dead, 1=running, 2=exited, 3=failed, 4=unknown
// memory is stored in bytes (uint64)
export interface ServiceRecord {
  id: string;
  system: string;
  name: string;
  state: number;  // 0=active,1=inactive,2=failed,3=activating,4=deactivating,5=reloading
  sub: number;    // 0=dead,1=running,2=exited,3=failed,4=unknown
  cpu: number;
  cpuPeak: number;
  memory: number; // bytes
  memPeak: number;
  updated: string;
}

export const ServiceState = {
  Active: 0, Inactive: 1, Failed: 2, Activating: 3, Deactivating: 4, Reloading: 5,
} as const;

export const ServiceStateName: Record<number, string> = {
  0: "active", 1: "inactive", 2: "failed", 3: "activating", 4: "deactivating", 5: "reloading",
};

export const ServiceSubName: Record<number, string> = {
  0: "dead", 1: "running", 2: "exited", 3: "failed", 4: "unknown",
};

// containers collection record
// memory is stored in MB (float64)

// smart_devices collection record
export interface SmartDeviceRecord {
  id: string;
  system: string;
  name: string;    // device name e.g. "sda"
  model: string;
  state: string;   // "PASSED" | "FAILED" | ""
  capacity: number; // bytes
  temp: number;    // celsius
  firmware: string;
  serial: string;
  type: string;    // "ata" | "nvme" | "scsi" etc.
  hours: number;   // power on hours
  cycles: number;  // power cycles
  updated: string;
}

export interface PocketBaseAuthResponse {
  token: string;
  record: {
    id: string;
    email: string;
  };
}

export interface PocketBaseList<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

export class BeszelClient {
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private config: BeszelConfig) {
    this.config.url = config.url.replace(/\/$/, "");
  }

  private async authenticate(): Promise<void> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiry - 5 * 60 * 1000) return;

    const res = await fetch(
      `${this.config.url}/api/collections/users/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: this.config.email,
          password: this.config.password,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Beszel auth failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as PocketBaseAuthResponse;
    this.token = data.token;

    try {
      const payload = JSON.parse(
        Buffer.from(data.token.split(".")[1], "base64url").toString("utf8")
      );
      this.tokenExpiry = payload.exp ? payload.exp * 1000 : Date.now() + 14 * 24 * 60 * 60 * 1000;
    } catch {
      this.tokenExpiry = Date.now() + 14 * 24 * 60 * 60 * 1000;
    }
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.authenticate();

    const url = new URL(`${this.config.url}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: this.token! },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Beszel API error (${res.status}) ${path}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getSystems(filter?: string): Promise<SystemRecord[]> {
    const params: Record<string, string> = {
      perPage: "200",
      sort: "name",
    };
    if (filter) params.filter = filter;

    const data = await this.get<PocketBaseList<SystemRecord>>(
      "/api/collections/systems/records",
      params
    );
    return data.items;
  }

  async getAlerts(triggered?: boolean): Promise<AlertRecord[]> {
    const params: Record<string, string> = { perPage: "200" };
    if (triggered !== undefined) {
      params.filter = `triggered=${triggered}`;
    }

    try {
      const data = await this.get<PocketBaseList<AlertRecord>>(
        "/api/collections/alerts/records",
        params
      );
      return data.items;
    } catch {
      return [];
    }
  }

  async getContainersForSystem(systemId: string): Promise<ContainerRecord[]> {
    try {
      const data = await this.get<PocketBaseList<ContainerRecord>>(
        "/api/collections/containers/records",
        { filter: `system="${systemId}"`, perPage: "200", sort: "name" }
      );
      return data.items;
    } catch {
      return [];
    }
  }

  async getServicesForSystem(systemId: string): Promise<ServiceRecord[]> {
    try {
      const data = await this.get<PocketBaseList<ServiceRecord>>(
        "/api/collections/systemd_services/records",
        { filter: `system="${systemId}"`, perPage: "200", sort: "name" }
      );
      return data.items;
    } catch {
      return [];
    }
  }

  async getSmartDevicesForSystem(systemId: string): Promise<SmartDeviceRecord[]> {
    try {
      const data = await this.get<PocketBaseList<SmartDeviceRecord>>(
        "/api/collections/smart_devices/records",
        { filter: `system="${systemId}"`, perPage: "200", sort: "name" }
      );
      return data.items;
    } catch {
      return [];
    }
  }
}
