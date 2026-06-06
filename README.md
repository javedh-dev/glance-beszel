# glance-beszel

A [Glance](https://github.com/glanceapp/glance) extension that pulls live system stats from [Beszel](https://beszel.dev) and renders a rich homelab overview widget, plus a GitHub Copilot usage widget.

## Features

- **Per-system rows** — OS/distro icon (with brand colors), system name, host IP, expandable detail
- **Stat bars** — CPU, RAM, disk usage with progress bars per system
- **Uptime & alert badges** — uptime and failed service count inline
- **Containers, services, disks** — expandable per-system sections
- **Alert banner** — highlighted list of currently triggered Beszel alerts
- **OS icons** — auto-detected from `system_details` (Debian, Ubuntu, Alpine, Fedora, Arch, NixOS, macOS, Proxmox, Raspberry Pi, and more)
- **Category icon overrides** — assign proxmox / vm / lxc / rpi / nas / docker icons to specific systems
- **Flexible ordering** — explicit system order via `order=` param
- **Filtering** — by system name or status
- **GitHub Copilot usage** — premium request usage by model with cost breakdown

---

## Quick start (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash
```

The installer will:
1. Install Node.js (via nvm) if not present
2. Download and build the extension
3. Prompt for Beszel URL, email, password, port, and install directory
4. Register and start a system service (systemd on Linux, launchd on macOS)

### Headless install

Set env vars before running to skip all prompts:

```bash
export BESZEL_URL=http://beszel:8090
export BESZEL_EMAIL=admin@example.com
export BESZEL_PASSWORD=your-password
export PORT=8088
export INSTALL_DIR=/opt/glance-beszel
export SERVICE_NAME=glance-beszel
curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash --headless
```
---

## Docker Compose

```yaml
services:
  glance-beszel:
    build: .
    restart: unless-stopped
    ports:
      - "8088:8088"
    environment:
      BESZEL_URL: "http://beszel:8090"
      BESZEL_EMAIL: "admin@example.com"
      BESZEL_PASSWORD: "your-password"
```

```bash
docker compose up -d
```

---

## Glance widget configuration

Add this to your `glance.yml`. Leave out `title:` to let the extension set it via the `Widget-Title` response header (defaults to `WIDGET_TITLE` env, default `"Beszel"`):

```yaml
- type: extension
  url: http://localhost:8088/
  allow-potentially-dangerous-html: true
  cache: 1m
```

Override title from Glance's side if preferred:

```yaml
- type: extension
  url: http://localhost:8088/
  allow-potentially-dangerous-html: true
  cache: 1m
  title: My Servers
  title-url: https://beszel.example.com
```

All options can be passed as query parameters per widget, overriding the server-side env defaults:

```yaml
- type: extension
  url: http://localhost:8088/?systems=pve,nexus&order=pve,nexus&icon_proxmox=pve&collapse_after=3
  allow-potentially-dangerous-html: true
  cache: 1m
```

### Copilot widget

Enable by setting `GH_TOKEN` (GitHub PAT with `read:billing` scope) and `GH_USERNAME`.

```yaml
- type: extension
  url: http://localhost:8088/copilot
  allow-potentially-dangerous-html: true
  cache: 5m
```

Query parameters:

| Param    | Example            | Description |
|----------|--------------------|-------------|
| `year`   | `?year=2026`       | Filter to a specific year (default: current) |
| `month`  | `?year=2026&month=5` | Filter to a specific month (1-12) |
| `model`  | `?model=claude-sonnet-4` | Filter by model name (case-insensitive) |
| `product`| `?product=copilot` | Filter by product name (case-insensitive) |

```yaml
- type: extension
  url: http://localhost:8088/copilot?year=2026&month=5
  allow-potentially-dangerous-html: true
  cache: 5m
```

### OpenRouter widget

Enable by setting `OPENROUTER_API_KEY`.

```yaml
- type: extension
  url: http://localhost:8088/openrouter
  allow-potentially-dangerous-html: true
  cache: 5m
```

### AI Credits (combined)

Shows all configured credit sources (Copilot + OpenRouter) in one widget. Filter with `?source=`:

```yaml
# Show both Copilot and OpenRouter
- type: extension
  url: http://localhost:8088/ai-credits
  allow-potentially-dangerous-html: true
  cache: 5m

# Show only Copilot
- type: extension
  url: http://localhost:8088/ai-credits?source=copilot
  allow-potentially-dangerous-html: true
  cache: 5m

# Show only OpenRouter
- type: extension
  url: http://localhost:8088/ai-credits?source=openrouter
  allow-potentially-dangerous-html: true
  cache: 5m
```

## Configuration

All settings are env vars (set in `.env` or the system service environment). Most can also be overridden per widget via query parameters.

### Core

| Variable           | Required | Default       | Description |
|--------------------|----------|---------------|-------------|
| `BESZEL_URL`       | **yes**  | —             | Base URL of your Beszel instance |
| `BESZEL_EMAIL`     | **yes**  | —             | Beszel login email |
| `BESZEL_PASSWORD`  | **yes**  | —             | Beszel login password |
| `PORT`             | no       | `8088`        | Port the extension listens on |
| `WIDGET_TITLE`     | no       | `Beszel`      | Widget title sent via `Widget-Title` header |
| `WIDGET_TITLE_URL` | no       | `$BESZEL_URL` | URL the widget title links to |
### Copilot

| Variable               | Required | Default          | Description |
|------------------------|----------|------------------|-------------|
| `GH_TOKEN`             | **yes*** | —                | GitHub PAT with `read:billing` scope (enables Copilot widget) |
| `GH_USERNAME`          | **yes*** | —                | GitHub username |
| `COPILOT_WIDGET_TITLE` | no       | `GitHub Copilot` | Widget title sent via `Widget-Title` header |
| `COPILOT_CACHE_TTL`    | no       | `300`            | Cache TTL in seconds |
| `COPILOT_CREDITS`      | no       | `1500`           | Total monthly AI credits allowed |
| `COPILOT_CREDIT_VALUE` | no       | `0.01`           | Dollar value per credit |

### OpenRouter

| Variable                   | Required | Default              | Description |
|----------------------------|----------|----------------------|-------------|
| `OPENROUTER_API_KEY`       | **yes*** | —                    | OpenRouter API key (shows credit balance) |
| `OPENROUTER_WIDGET_TITLE`  | no       | `OpenRouter Credits` | Widget title sent via `Widget-Title` header |
| `OPENROUTER_CACHE_TTL`     | no       | `300`                | Cache TTL in seconds |

*\* Required only when using the respective widget.*

### Display

| Variable          | Query param      | Default    | Description |
|-------------------|------------------|------------|-------------|
| `SHOW_ALERTS`     | —                | `true`     | Show triggered alert banner |
| `COLLAPSE_AFTER`  | `collapse_after` | `0`        | Collapse list after N systems (`0` = all expanded) |
| `SYSTEM_FILTER`   | `systems`        | _(all)_    | Comma-separated system names, or raw PocketBase filter expression |
| `STATUS_FILTER`   | `status`         | _(all)_    | Filter by status: `up`, `down`, or empty for all |
| `SYSTEM_ORDER`    | `order`          | _(alpha)_  | Explicit display order, comma-separated system names |

### Icon category overrides

Assign a named icon category to specific systems. Systems not listed fall back to auto-detected OS icon.

| Variable / Query param | Icon | Description |
|------------------------|------|-------------|
| `ICON_PROXMOX` / `icon_proxmox` | Proxmox logo (orange + grey) | Proxmox VE hosts |
| `ICON_VM` / `icon_vm` | Server (lucide) | Virtual machines |
| `ICON_LXC` / `icon_lxc` | Linux Containers logo | LXC containers |
| `ICON_RPI` / `icon_rpi` | Raspberry Pi logo | Raspberry Pi devices |
| `ICON_NAS` / `icon_nas` | HardDrive (lucide) | NAS devices |
| `ICON_DOCKER` / `icon_docker` | Docker logo | Docker hosts |
| `ICON_WINDOWS` / `icon_windows` | Windows logo | Windows systems |
| `ICON_MAC` / `icon_mac` | Apple logo (grey) | macOS systems |
| `ICON_LINUX` / `icon_linux` | Linux (Tux) logo | Generic Linux |

Each value is a comma-separated list of system names (case-insensitive):

```env
ICON_PROXMOX=pve,pve2
ICON_VM=win-server,ubuntu-vm
ICON_LXC=ct1,ct2,ct3
ICON_RPI=pi4,pi5
ICON_NAS=truenas
```

Or per widget in `glance.yml`:

```yaml
url: http://localhost:8088/?icon_proxmox=pve&icon_lxc=ct1,ct2&icon_vm=win-server
```

---

## Ordering and filtering examples

Show only specific systems in a fixed order:
```
/?systems=pve,nexus,pi5&order=pve,nexus,pi5
```

Show only running systems:
```
/?status=up
```

Show all down systems:
```
/?status=down
```

Filter by name pattern (raw PocketBase expression):
```
/?systems=name~"prod"
```

---

## Project structure

```
.
├── src/
│   ├── index.ts           # Express server, query param handling, sort/filter logic
│   ├── beszel.ts          # Beszel/PocketBase API client and TypeScript interfaces
│   ├── template.ts        # EJS renderer, icon helpers (lucide + simple-icons)
│   ├── copilot.ts           # GitHub Copilot billing API client
│   ├── copilot-template.ts  # Copilot EJS renderer and icon helpers
│   ├── openrouter.ts        # OpenRouter credits API client
│   └── openrouter-template.ts # OpenRouter EJS renderer
├── templates/
│   ├── widget.ejs          # Beszel root template, CSS, system list
│   ├── system-entry.ejs    # Per-system row (icon, name, IP, stat bars, expand)
│   ├── stat-bars.ejs       # CPU/RAM/disk progress bars
│   ├── containers.ejs      # Docker/Podman containers section
│   ├── services.ejs        # Systemd services section
│   ├── smart-devices.ejs   # SMART disk health section
│   ├── alert-banner.ejs    # Triggered alerts banner
│   ├── copilot.ejs         # Copilot premium request usage widget
│   └── openrouter.ejs      # OpenRouter credits widget
├── install.sh          # One-liner installer (systemd + launchd)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Development

```bash
npm install
npm run build   # compile TypeScript to dist/
npm start       # run compiled output
npm run dev     # ts-node watch mode
```
