# glance-beszel-extension

A [Glance](https://github.com/glanceapp/glance) extension that pulls live system stats from [Beszel](https://beszel.dev) and renders a rich homelab overview widget.

## Preview

The widget displays:

- **Summary bar** — total/online/down system counts, average CPU & memory, active alert count
- **Alert banner** — highlighted list of any currently triggered alerts
- **Per-system cards** — status dot, CPU/memory/disk progress bars, bandwidth (↑/↓), uptime, kernel version

## Requirements

- Node.js 20+ (for shell deployment) or Docker
- A running Beszel instance with API access
- Glance with `allow-potentially-dangerous-html: true` on the extension widget

---

## Quick start

### Docker Compose

```yaml
# docker-compose.yml
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

### Shell script

```bash
git clone <this-repo>
cd glance-beszel-extension

BESZEL_URL=http://localhost:8090 \
BESZEL_EMAIL=admin@example.com \
BESZEL_PASSWORD=your-password \
./run.sh
```

---

## Configuration

All configuration is done via environment variables.

| Variable          | Required | Default              | Description |
|-------------------|----------|----------------------|-------------|
| `BESZEL_URL`      | **yes**  | —                    | Base URL of your Beszel instance |
| `BESZEL_EMAIL`    | **yes**  | —                    | Beszel user email |
| `BESZEL_PASSWORD` | **yes**  | —                    | Beszel user password |
| `PORT`            | no       | `8088`               | Port the extension listens on |
| `WIDGET_TITLE`    | no       | `Beszel`            | Title shown in the Glance widget header |
| `WIDGET_TITLE_URL`| no       | `$BESZEL_URL`        | URL the widget title links to |
| `SHOW_SUMMARY`    | no       | `true`               | Show the top summary stats bar |
| `SHOW_ALERTS`     | no       | `true`               | Show triggered alert banner |
| `COLLAPSE_AFTER`  | no       | `0` (disabled)       | Collapse list after N systems (Glance collapsible) |
| `SYSTEM_FILTER`   | no       | _(all)_              | PocketBase filter expression, e.g. `name~"prod"` |
| `STATUS_FILTER`   | no       | _(all)_              | Quick filter: `up`, `down`, or empty for all |

### Filter examples

Show only running systems named "prod-*":
```
SYSTEM_FILTER=name~"prod" STATUS_FILTER=up
```

Show all down systems:
```
STATUS_FILTER=down
```

---

## Glance widget configuration

Add this to your Glance `glance.yml`:

```yaml
- type: extension
  url: http://localhost:8088
  allow-potentially-dangerous-html: true
  cache: 1m
```

Optionally override the title from Glance's side:
```yaml
- type: extension
  url: http://localhost:8088
  allow-potentially-dangerous-html: true
  cache: 1m
  title: My Servers
  title-url: https://beszel.example.com
```

---

## Project structure

```
.
├── src/
│   ├── index.ts       # Express server + Glance headers
│   ├── beszel.ts      # Beszel/PocketBase API client
│   └── template.ts    # HTML widget renderer
├── Dockerfile
├── docker-compose.yml
├── run.sh             # Shell deployment script
├── package.json
└── tsconfig.json
```

## Development

```bash
npm install
npm run dev        # ts-node hot run
npm run build      # compile to dist/
npm start          # run compiled output
```
