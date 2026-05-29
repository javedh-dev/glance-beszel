#!/usr/bin/env bash
# install.sh — Install and start the Glance Beszel extension as a system service
#
# ── One-liner install (recommended) ────────────────────────────────────────────
#
#   Interactive:
#     curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash
#
#   Headless (CI / automation):
#     curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh \
#       | BESZEL_URL=http://192.168.1.5:8090 \
#         BESZEL_EMAIL=admin@example.com \
#         BESZEL_PASSWORD=secret \
#         bash -s -- --headless
#
# ── Local usage ─────────────────────────────────────────────────────────────────
#
#   ./install.sh              interactive
#   ./install.sh --headless   non-interactive, reads env vars (see --help)
#
# ── Headless env vars ────────────────────────────────────────────────────────────
#   Required : BESZEL_URL, BESZEL_EMAIL, BESZEL_PASSWORD
#   Optional : PORT (8088), WIDGET_TITLE (Homelab), WIDGET_TITLE_URL,
#              SHOW_ALERTS (true), COLLAPSE_AFTER (0),
#              SYSTEM_FILTER, STATUS_FILTER,
#              INSTALL_DIR (/opt/glance-beszel), SERVICE_NAME (glance-beszel)
#   Nginx    : SETUP_NGINX (false), NGINX_PORT (80), NGINX_SERVER_NAME (localhost),
#              EXPOSE_PUBLIC (false)

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# BOOTSTRAP — auto-download when piped through curl | bash
#
# When bash executes a piped script, BASH_SOURCE[0] is empty or equals "bash".
# In that case we download the full repository as a tarball, extract it, and
# re-exec the real install.sh from the extracted source tree so that
# SCRIPT_DIR is a real directory containing src/, templates/, etc.
# ─────────────────────────────────────────────────────────────────────────────

GITHUB_REPO="javedh-dev/glance-beszel"
GITHUB_BRANCH="main"
GITHUB_TARBALL="https://github.com/${GITHUB_REPO}/archive/refs/heads/${GITHUB_BRANCH}.tar.gz"

_bootstrap() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp_dir}'" EXIT

  echo ""
  echo "==> Downloading glance-beszel from GitHub ..."

  # Prefer curl, fall back to wget
  if command -v curl &>/dev/null; then
    curl -fsSL "$GITHUB_TARBALL" | tar -xz -C "$tmp_dir"
  elif command -v wget &>/dev/null; then
    wget -qO- "$GITHUB_TARBALL" | tar -xz -C "$tmp_dir"
  else
    echo "ERROR: neither curl nor wget is available. Install one and re-run." >&2
    exit 1
  fi

  # GitHub extracts as <repo>-<branch>/
  local src_dir
  src_dir="$(find "$tmp_dir" -maxdepth 1 -mindepth 1 -type d | head -1)"

  # Remove the exit trap so the temp dir survives the exec
  trap - EXIT

  echo "==> Launching installer from ${src_dir} ..."
  exec bash "${src_dir}/install.sh" "$@"
}

# Detect pipe: BASH_SOURCE[0] is empty, "bash", or a /dev/fd/... path
_src="${BASH_SOURCE[0]:-}"
if [[ -z "$_src" || "$_src" == "bash" || "$_src" == "/dev/stdin" || "$_src" =~ ^/dev/fd/ ]]; then
  _bootstrap "$@"
  # exec above never returns; this is a safety net
  exit 1
fi
unset _src

# ─────────────────────────────────────────────
# Colour helpers
# ─────────────────────────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}==>${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD} ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD} !${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}ERROR:${RESET} $*" >&2; exit 1; }

# ─────────────────────────────────────────────
# Prompt helpers
# ─────────────────────────────────────────────

# ask_var VAR_NAME "Question text" "default"
# Headless: uses existing env var or default, no prompt.
ask_var() {
  local varname="$1" question="$2" default="$3"
  if [[ "$HEADLESS" == "true" ]]; then
    local cur="${!varname:-}"
    printf -v "$varname" '%s' "${cur:-$default}"
    return
  fi
  local cur="${!varname:-}"
  local shown="${cur:-$default}"
  echo -en "${BOLD}${question}${RESET}"
  [[ -n "$shown" ]] && echo -en " ${CYAN}[${shown}]${RESET}"
  echo -en ": "
  local inp; read -r inp
  printf -v "$varname" '%s' "${inp:-$shown}"
}

# ask_secret VAR_NAME "Question text"
# Never echoes input. In headless mode the var must already be set.
ask_secret() {
  local varname="$1" question="$2"
  if [[ "$HEADLESS" == "true" ]]; then
    local cur="${!varname:-}"
    [[ -n "$cur" ]] || die "$varname must be set when running headless"
    return
  fi
  local cur="${!varname:-}"
  echo -en "${BOLD}${question}${RESET}"
  [[ -n "$cur" ]] && echo -en " ${CYAN}[already set]${RESET}"
  echo -en ": "
  local inp; read -rs inp; echo
  if [[ -n "$inp" ]]; then
    printf -v "$varname" '%s' "$inp"
  elif [[ -z "$cur" ]]; then
    die "$varname is required"
  fi
}

# ask_confirm "Question" [y|n]  — returns 0=yes, 1=no
# Headless always returns 0 (yes).
ask_confirm() {
  local question="$1" default="${2:-y}"
  if [[ "$HEADLESS" == "true" ]]; then return 0; fi
  local hint="[Y/n]"; [[ "$default" == "n" ]] && hint="[y/N]"
  echo -en "${BOLD}${question}${RESET} ${CYAN}${hint}${RESET}: "
  local inp; read -r inp
  inp="${inp:-$default}"
  [[ "$inp" =~ ^[Yy] ]]
}

# ask_confirm_default_no: headless returns 1 (no) — safe default
ask_confirm_no() {
  local question="$1"
  if [[ "$HEADLESS" == "true" ]]; then return 1; fi
  echo -en "${BOLD}${question}${RESET} ${CYAN}[y/N]${RESET}: "
  local inp; read -r inp
  inp="${inp:-n}"
  [[ "$inp" =~ ^[Yy] ]]
}

# ─────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────

HEADLESS="false"
for arg in "$@"; do
  case "$arg" in
    --headless) HEADLESS="true" ;;
    --help|-h)
      cat <<HELP
Glance Beszel Extension — Installer

ONE-LINER INSTALL (downloads from GitHub automatically):

  Interactive:
    curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash

  Headless:
    curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh \\
      | BESZEL_URL=http://192.168.1.5:8090 \\
        BESZEL_EMAIL=admin@example.com \\
        BESZEL_PASSWORD=secret \\
        bash -s -- --headless

LOCAL USAGE:
  $0              interactive
  $0 --headless   non-interactive (reads env vars below)
  $0 --help       show this help

REQUIRED (headless):
  BESZEL_URL          URL of your Beszel instance  e.g. http://192.168.1.5:8090
  BESZEL_EMAIL        Beszel admin e-mail
  BESZEL_PASSWORD     Beszel admin password

OPTIONAL (headless):
  PORT                Node listener port            default: 8088
  WIDGET_TITLE        Widget title shown in Glance  default: Homelab
  WIDGET_TITLE_URL    URL the title links to        default: BESZEL_URL
  SHOW_ALERTS         Show alert banner             default: true
  COLLAPSE_AFTER      Collapse list after N items   default: 0
  SYSTEM_FILTER       Comma-separated system names  default: (all)
  STATUS_FILTER       up / down / paused            default: (all)
  INSTALL_DIR         Where to install              default: /opt/glance-beszel
  SERVICE_NAME        systemd/launchd service name  default: glance-beszel

NGINX (headless):
  SETUP_NGINX         Set up nginx reverse proxy    default: false
  NGINX_PORT          nginx listen port             default: 80
  NGINX_SERVER_NAME   server_name directive         default: localhost
  EXPOSE_PUBLIC       Listen on 0.0.0.0 (public)   default: false
                      When false nginx binds to 127.0.0.1 only
HELP
      exit 0
      ;;
    *) die "Unknown argument: $arg  (try --help)" ;;
  esac
done

# ─────────────────────────────────────────────
# Detect OS / init system
# ─────────────────────────────────────────────

OS="$(uname -s)"
INIT_SYSTEM="none"
[[ "$OS" == "Linux" ]] && command -v systemctl &>/dev/null && INIT_SYSTEM="systemd"
[[ "$OS" == "Darwin" ]] && INIT_SYSTEM="launchd"

# ─────────────────────────────────────────────
# Node.js — install automatically if missing or too old
# ─────────────────────────────────────────────

# Install Node.js via the official NodeSource setup script (Linux) or
# nvm (macOS / Linux fallback). We target the LTS line (Node 20).
NODE_TARGET_MAJOR=20

_install_node_linux() {
  info "Installing Node.js ${NODE_TARGET_MAJOR} LTS via NodeSource ..."
  local setup_url="https://deb.nodesource.com/setup_${NODE_TARGET_MAJOR}.x"

  if command -v apt-get &>/dev/null; then
    curl -fsSL "$setup_url" | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_TARGET_MAJOR}.x" | sudo bash -
    sudo dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_TARGET_MAJOR}.x" | sudo bash -
    sudo yum install -y nodejs
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm nodejs npm
  elif command -v zypper &>/dev/null; then
    sudo zypper install -y nodejs20
  else
    _install_node_nvm
  fi
}

_install_node_brew() {
  if ! command -v brew &>/dev/null; then
    warn "Homebrew not found — falling back to nvm"
    _install_node_nvm
    return
  fi
  info "Installing Node.js via Homebrew ..."
  brew install node@${NODE_TARGET_MAJOR}
  # Homebrew keg-only: add to PATH for this session
  local brew_prefix
  brew_prefix="$(brew --prefix)"
  export PATH="${brew_prefix}/opt/node@${NODE_TARGET_MAJOR}/bin:${PATH}"
}

_install_node_nvm() {
  info "Installing Node.js via nvm ..."
  local nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  # Download and source nvm if not already present
  if [[ ! -s "${nvm_dir}/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck source=/dev/null
  source "${nvm_dir}/nvm.sh"
  nvm install "${NODE_TARGET_MAJOR}"
  nvm use "${NODE_TARGET_MAJOR}"
  # Make node visible to the rest of this script
  export PATH="${nvm_dir}/versions/node/$(nvm version)/bin:${PATH}"
}

check_node() {
  local ver major needs_install=false

  if command -v node &>/dev/null; then
    ver="$(node --version)"
    major="${ver#v}"; major="${major%%.*}"
    if (( major >= 18 )); then
      success "Node.js ${ver}"
      return
    fi
    warn "Node.js ${ver} is too old (need 18+) — will install Node.js ${NODE_TARGET_MAJOR}"
    needs_install=true
  else
    warn "Node.js not found — will install Node.js ${NODE_TARGET_MAJOR} LTS automatically"
    needs_install=true
  fi

  if [[ "$needs_install" == "true" ]]; then
    if [[ "$HEADLESS" != "true" ]]; then
      ask_confirm "Install Node.js ${NODE_TARGET_MAJOR} LTS now?" "y" || \
        die "Node.js is required. Install it manually from https://nodejs.org and re-run."
    fi

    if [[ "$OS" == "Linux" ]]; then
      _install_node_linux
    elif [[ "$OS" == "Darwin" ]]; then
      _install_node_brew
    else
      _install_node_nvm
    fi

    # Verify the install worked
    command -v node &>/dev/null || die "Node.js installation failed. Install manually from https://nodejs.org"
    ver="$(node --version)"
    success "Node.js ${ver} installed"
  fi
}

# ─────────────────────────────────────────────
# Check nginx
# ─────────────────────────────────────────────

check_nginx() {
  if command -v nginx &>/dev/null; then
    success "nginx $(nginx -v 2>&1 | grep -o '[0-9.]*' | head -1) found"
    return 0
  fi
  warn "nginx is not installed."
  if [[ "$HEADLESS" == "true" ]]; then
    die "SETUP_NGINX=true but nginx is not installed. Install nginx and re-run."
  fi
  if ask_confirm "Attempt to install nginx now?" "y"; then
    if [[ "$OS" == "Linux" ]]; then
      if command -v apt-get &>/dev/null; then
        sudo apt-get install -y nginx
      elif command -v dnf &>/dev/null; then
        sudo dnf install -y nginx
      elif command -v yum &>/dev/null; then
        sudo yum install -y nginx
      elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm nginx
      else
        die "Cannot auto-install nginx on this distro. Install it manually and re-run."
      fi
    elif [[ "$OS" == "Darwin" ]]; then
      command -v brew &>/dev/null || die "Homebrew not found. Install nginx manually: brew install nginx"
      brew install nginx
    else
      die "Unsupported OS for auto-install. Install nginx manually and re-run."
    fi
    success "nginx installed"
  else
    die "nginx is required for the nginx setup. Aborting nginx configuration."
  fi
}

# ─────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}   Glance Beszel Extension — Installer${RESET}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

if [[ "$HEADLESS" == "true" ]]; then
  warn "Headless mode — reading all settings from environment variables"
else
  info "This script will:"
  echo "  1. Ask for your Beszel connection details and preferences"
  echo "  2. Download and install the extension to a directory of your choice"
  echo "  3. Register and start it as a background service"
  echo "  4. Optionally configure nginx as a reverse proxy"
  echo ""
  echo -e "  ${CYAN}Tip:${RESET} next time you can skip cloning entirely:"
  echo -e "  ${BOLD}curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash${RESET}"
  echo ""
fi

check_node

# ─────────────────────────────────────────────
# Gather: Beszel connection
# ─────────────────────────────────────────────

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Beszel Connection ──────────────────────────${RESET}"

ask_var    BESZEL_URL      "Beszel URL"           "http://localhost:8090"
ask_secret BESZEL_EMAIL    "Beszel admin e-mail"
ask_secret BESZEL_PASSWORD "Beszel admin password"

# ─────────────────────────────────────────────
# Gather: server / widget settings
# ─────────────────────────────────────────────

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Server & Widget Settings ───────────────────${RESET}"

ask_var PORT              "Node listener port (internal)"   "8088"
ask_var WIDGET_TITLE      "Widget title"                    "Homelab"
ask_var WIDGET_TITLE_URL  "Widget title URL"                "${BESZEL_URL}"
ask_var SHOW_ALERTS       "Show alert banner (true/false)"  "true"
ask_var COLLAPSE_AFTER    "Collapse after N systems (0=all expanded)" "0"

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Filtering (optional) ───────────────────────${RESET}"

ask_var SYSTEM_FILTER "System filter (comma-separated names or PocketBase expr; blank=all)" ""
ask_var STATUS_FILTER "Status filter (up / down / paused; blank=all)" ""

# ─────────────────────────────────────────────
# Gather: install path
# ─────────────────────────────────────────────

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Install Location ───────────────────────────${RESET}"

ask_var INSTALL_DIR  "Install directory" "/opt/glance-beszel"
ask_var SERVICE_NAME "Service name"      "glance-beszel"

# ─────────────────────────────────────────────
# Gather: nginx
# ─────────────────────────────────────────────

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Nginx Reverse Proxy ────────────────────────${RESET}"

# Determine whether to set up nginx
SETUP_NGINX="${SETUP_NGINX:-false}"
if [[ "$HEADLESS" != "true" ]]; then
  if ask_confirm_no "Set up nginx as a reverse proxy for the extension?"; then
    SETUP_NGINX="true"
  else
    SETUP_NGINX="false"
  fi
fi

NGINX_PORT="${NGINX_PORT:-80}"
NGINX_SERVER_NAME="${NGINX_SERVER_NAME:-localhost}"
EXPOSE_PUBLIC="${EXPOSE_PUBLIC:-false}"
NGINX_CONF_NAME="${SERVICE_NAME}"

if [[ "$SETUP_NGINX" == "true" ]]; then
  ask_var NGINX_PORT        "nginx listen port"     "80"
  ask_var NGINX_SERVER_NAME "nginx server_name"     "localhost"

  echo ""
  echo -e "  ${YELLOW}${BOLD}Access restriction${RESET}"
  echo -e "  By default nginx will only accept connections from ${BOLD}localhost (127.0.0.1)${RESET}."
  echo -e "  This means the widget is only reachable from this machine."
  echo -e "  Change this only if Glance is running on a ${BOLD}different host${RESET} or you want"
  echo -e "  the widget accessible from your local network / the internet."
  echo ""

  # Default is NO (keep it local) — user must explicitly opt in to expose
  EXPOSE_PUBLIC="false"
  if [[ "$HEADLESS" != "true" ]]; then
    if ask_confirm_no "Expose nginx beyond localhost (bind to 0.0.0.0)?"; then
      EXPOSE_PUBLIC="true"
      warn "The widget will be reachable from any IP that can reach port ${NGINX_PORT}."
      warn "Ensure your firewall only allows trusted hosts."
    fi
  else
    # Headless: respect EXPOSE_PUBLIC env var, default false
    EXPOSE_PUBLIC="${EXPOSE_PUBLIC:-false}"
  fi
fi

# ─────────────────────────────────────────────
# Summary + confirmation
# ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}── Summary ─────────────────────────────────────${RESET}"
echo -e "  Install dir     : ${BOLD}${INSTALL_DIR}${RESET}"
echo -e "  Service name    : ${BOLD}${SERVICE_NAME}${RESET}"
echo -e "  Init system     : ${BOLD}${INIT_SYSTEM}${RESET}"
echo -e "  Beszel URL      : ${BOLD}${BESZEL_URL}${RESET}"
echo -e "  Node port       : ${BOLD}127.0.0.1:${PORT}${RESET}  (loopback only)"
echo -e "  Widget title    : ${BOLD}${WIDGET_TITLE}${RESET}"
echo -e "  Show alerts     : ${BOLD}${SHOW_ALERTS}${RESET}"
echo -e "  Collapse after  : ${BOLD}${COLLAPSE_AFTER}${RESET}"
[[ -n "${SYSTEM_FILTER:-}" ]] && echo -e "  System filter   : ${BOLD}${SYSTEM_FILTER}${RESET}"
[[ -n "${STATUS_FILTER:-}" ]] && echo -e "  Status filter   : ${BOLD}${STATUS_FILTER}${RESET}"
if [[ "$SETUP_NGINX" == "true" ]]; then
  if [[ "$EXPOSE_PUBLIC" == "true" ]]; then
    echo -e "  nginx           : ${BOLD}0.0.0.0:${NGINX_PORT}${RESET} → 127.0.0.1:${PORT}  ${RED}(public)${RESET}"
  else
    echo -e "  nginx           : ${BOLD}127.0.0.1:${NGINX_PORT}${RESET} → 127.0.0.1:${PORT}  ${GREEN}(localhost only)${RESET}"
  fi
  echo -e "  nginx hostname  : ${BOLD}${NGINX_SERVER_NAME}${RESET}"
else
  echo -e "  nginx           : ${BOLD}not configured${RESET}"
fi
echo ""

if ! ask_confirm "Proceed with installation?"; then
  echo "Aborted."
  exit 0
fi

# ─────────────────────────────────────────────
# Source directory
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────
# Copy files
# ─────────────────────────────────────────────

echo ""
info "Installing files to ${INSTALL_DIR} ..."

if [[ "$INSTALL_DIR" != "$SCRIPT_DIR" ]]; then
  mkdir -p "$INSTALL_DIR"
  cp -r "${SCRIPT_DIR}/src"               "${INSTALL_DIR}/"
  cp -r "${SCRIPT_DIR}/templates"         "${INSTALL_DIR}/"
  cp    "${SCRIPT_DIR}/package.json"      "${INSTALL_DIR}/"
  cp    "${SCRIPT_DIR}/tsconfig.json"     "${INSTALL_DIR}/"
  cp    "${SCRIPT_DIR}/package-lock.json" "${INSTALL_DIR}/" 2>/dev/null || true
  success "Source files copied"
else
  success "Running from source directory — skipping copy"
fi

# ─────────────────────────────────────────────
# Write .env
# ─────────────────────────────────────────────

ENV_FILE="${INSTALL_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak"
  warn "Existing .env backed up → ${ENV_FILE}.bak"
fi

cat > "$ENV_FILE" <<EOF
# Generated by install.sh — $(date)
# The Node process binds to 127.0.0.1 (loopback) only.
# Expose externally via nginx (see nginx config below).

# --- Required ---
BESZEL_URL=${BESZEL_URL}
BESZEL_EMAIL=${BESZEL_EMAIL}
BESZEL_PASSWORD=${BESZEL_PASSWORD}

# --- Server ---
PORT=${PORT}

# --- Widget appearance ---
WIDGET_TITLE=${WIDGET_TITLE}
WIDGET_TITLE_URL=${WIDGET_TITLE_URL}

# --- Display options ---
SHOW_ALERTS=${SHOW_ALERTS}
COLLAPSE_AFTER=${COLLAPSE_AFTER}

# --- Filtering ---
SYSTEM_FILTER=${SYSTEM_FILTER:-}
STATUS_FILTER=${STATUS_FILTER:-}
EOF

chmod 600 "$ENV_FILE"
success ".env written (mode 600)"

# ─────────────────────────────────────────────
# Install deps + build
# ─────────────────────────────────────────────

info "Installing npm dependencies and building ..."
(
  cd "$INSTALL_DIR"
  # Full install first (needs devDeps for tsc)
  npm install 2>&1 | grep -v "^npm warn" || true
  npm run build
  # Strip devDependencies from final install
  npm prune --omit=dev 2>&1 | grep -v "^npm warn" || true
)
success "Build complete → ${INSTALL_DIR}/dist/index.js"

# ─────────────────────────────────────────────
# Launcher script
# The Node process listens on 127.0.0.1 only — not 0.0.0.0.
# This ensures it is unreachable from outside without nginx.
# ─────────────────────────────────────────────

LAUNCHER="${INSTALL_DIR}/start.sh"
cat > "$LAUNCHER" <<'LAUNCHER_EOF'
#!/usr/bin/env bash
# Auto-generated by install.sh — re-run install.sh to regenerate
set -euo pipefail
LAUNCHER_EOF

cat >> "$LAUNCHER" <<EOF
cd "${INSTALL_DIR}"
set -o allexport
source "${ENV_FILE}"
set +o allexport

# Force Node to bind on loopback only regardless of what HOST env var says.
# nginx (or Glance on the same machine) proxies through to here.
export HOST=127.0.0.1

exec node "${INSTALL_DIR}/dist/index.js"
EOF

chmod +x "$LAUNCHER"
success "Launcher written: ${LAUNCHER}"

# ─────────────────────────────────────────────
# Also patch src/index.ts listen call to respect HOST env var
# so the binding above actually takes effect without code changes.
# ─────────────────────────────────────────────

INDEX_SRC="${INSTALL_DIR}/src/index.ts"
if grep -q "app.listen(PORT," "$INDEX_SRC" 2>/dev/null && \
   ! grep -q "HOST" "$INDEX_SRC" 2>/dev/null; then
  sed -i.bak \
    "s/app\.listen(PORT,/const HOST = process.env.HOST || '127.0.0.1';\napp.listen(PORT, HOST,/" \
    "$INDEX_SRC"
  # Rebuild with the patch
  info "Patching listen address and rebuilding ..."
  (
    cd "$INSTALL_DIR"
    npm install 2>&1 | grep -v "^npm warn" || true
    npm run build
    npm prune --omit=dev 2>&1 | grep -v "^npm warn" || true
  )
  success "Listen address patched → 127.0.0.1:${PORT}"
fi

# ─────────────────────────────────────────────
# System service
# ─────────────────────────────────────────────

NODE_BIN="$(command -v node)"
SERVICE_INSTALLED="false"
SYSTEMD_SCOPE="system"   # default; overridden below if user-scope chosen

# ── systemd ──────────────────────────────────
if [[ "$INIT_SYSTEM" == "systemd" ]]; then

  SYSTEMD_DIR="/etc/systemd/system"
  USE_SUDO=""

  if [[ $EUID -ne 0 ]]; then
    if [[ "$HEADLESS" == "true" ]] || ask_confirm "Not running as root. Install as a user systemd service?"; then
      SYSTEMD_SCOPE="user"
      SYSTEMD_DIR="${HOME}/.config/systemd/user"
      mkdir -p "$SYSTEMD_DIR"
    else
      USE_SUDO="sudo"
    fi
  fi

  UNIT_FILE="${SYSTEMD_DIR}/${SERVICE_NAME}.service"
  CURRENT_USER="$(id -un)"

  info "Writing systemd unit → ${UNIT_FILE}"

  {
    cat <<UNIT
[Unit]
Description=Glance Beszel Extension
After=network.target

[Service]
Type=simple
ExecStart=${LAUNCHER}
Restart=on-failure
RestartSec=5
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${INSTALL_DIR}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
UNIT
    [[ "$SYSTEMD_SCOPE" == "system" ]] && echo "User=${CURRENT_USER}"
    echo ""
    echo "[Install]"
    [[ "$SYSTEMD_SCOPE" == "user" ]] && echo "WantedBy=default.target" || echo "WantedBy=multi-user.target"
  } > /tmp/${SERVICE_NAME}.service.tmp

  if [[ "$SYSTEMD_SCOPE" == "system" ]]; then
    $USE_SUDO cp /tmp/${SERVICE_NAME}.service.tmp "$UNIT_FILE"
    $USE_SUDO systemctl daemon-reload
    $USE_SUDO systemctl enable  "${SERVICE_NAME}.service"
    $USE_SUDO systemctl restart "${SERVICE_NAME}.service"
  else
    cp /tmp/${SERVICE_NAME}.service.tmp "$UNIT_FILE"
    systemctl --user daemon-reload
    systemctl --user enable  "${SERVICE_NAME}.service"
    systemctl --user restart "${SERVICE_NAME}.service"
  fi
  rm -f /tmp/${SERVICE_NAME}.service.tmp

  SERVICE_INSTALLED="true"
  success "systemd service '${SERVICE_NAME}' enabled and started"

# ── launchd ──────────────────────────────────
elif [[ "$INIT_SYSTEM" == "launchd" ]]; then

  PLIST_LABEL="com.glance-beszel.${SERVICE_NAME}"
  PLIST_DIR="${HOME}/Library/LaunchAgents"
  PLIST_FILE="${PLIST_DIR}/${PLIST_LABEL}.plist"
  LOG_DIR="${HOME}/Library/Logs"
  mkdir -p "$PLIST_DIR"

  info "Writing launchd plist → ${PLIST_FILE}"
  cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${LAUNCHER}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:$(dirname "$NODE_BIN")</string>
    <key>HOST</key>
    <string>127.0.0.1</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/${SERVICE_NAME}.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/${SERVICE_NAME}.err.log</string>
</dict>
</plist>
PLIST

  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  launchctl load -w "$PLIST_FILE"

  SERVICE_INSTALLED="true"
  success "launchd agent '${PLIST_LABEL}' loaded and started"

# ── no init system ────────────────────────────
else
  warn "Could not detect systemd or launchd — service NOT registered."
  warn "Start manually: ${LAUNCHER}"
fi

# ─────────────────────────────────────────────
# Nginx configuration
# ─────────────────────────────────────────────

NGINX_INSTALLED="false"

if [[ "$SETUP_NGINX" == "true" ]]; then

  check_nginx

  # Resolve nginx config directories
  NGINX_CONF_DIR=""
  for d in /etc/nginx/sites-available /etc/nginx/conf.d /usr/local/etc/nginx/servers; do
    [[ -d "$d" ]] && NGINX_CONF_DIR="$d" && break
  done
  [[ -n "$NGINX_CONF_DIR" ]] || die "Cannot locate nginx config directory. Checked: sites-available, conf.d, servers."

  NGINX_ENABLED_DIR=""
  [[ -d /etc/nginx/sites-enabled ]] && NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"

  NGINX_CONF_FILE="${NGINX_CONF_DIR}/${NGINX_CONF_NAME}.conf"

  # Decide listen directive based on exposure choice
  if [[ "$EXPOSE_PUBLIC" == "true" ]]; then
    NGINX_LISTEN_ADDR="${NGINX_PORT}"          # 0.0.0.0 (default)
    NGINX_LISTEN_ADDR6="[::]:${NGINX_PORT}"
    ACCESS_COMMENT="# Public: accepts connections from any IP"
  else
    NGINX_LISTEN_ADDR="127.0.0.1:${NGINX_PORT}"
    NGINX_LISTEN_ADDR6=""                      # no IPv6 bind when local-only
    ACCESS_COMMENT="# Local-only: only reachable from this machine"
  fi

  info "Writing nginx config → ${NGINX_CONF_FILE}"

  {
    cat <<NGINX
# Glance Beszel Extension — generated by install.sh $(date)
${ACCESS_COMMENT}
#
# Node process: 127.0.0.1:${PORT}  (loopback — not directly reachable externally)
# nginx proxy : ${NGINX_LISTEN_ADDR}
#
# To change access restriction re-run install.sh and answer the exposure question.

server {
    listen ${NGINX_LISTEN_ADDR};
NGINX
    [[ -n "$NGINX_LISTEN_ADDR6" ]] && echo "    listen ${NGINX_LISTEN_ADDR6};"
    cat <<NGINX

    server_name ${NGINX_SERVER_NAME};

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"   always;
    add_header X-Content-Type-Options "nosniff"      always;
    add_header Referrer-Policy        "no-referrer"  always;

    # Forward all requests to the Node process on loopback
    location / {
        proxy_pass         http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        proxy_connect_timeout 5s;
    }
}
NGINX
  } > /tmp/${NGINX_CONF_NAME}.conf.tmp

  # Write with sudo if needed
  if [[ -w "$NGINX_CONF_DIR" ]]; then
    cp /tmp/${NGINX_CONF_NAME}.conf.tmp "$NGINX_CONF_FILE"
  else
    sudo cp /tmp/${NGINX_CONF_NAME}.conf.tmp "$NGINX_CONF_FILE"
  fi
  rm -f /tmp/${NGINX_CONF_NAME}.conf.tmp

  # Enable site (Debian/Ubuntu sites-enabled symlink pattern)
  if [[ -n "$NGINX_ENABLED_DIR" ]] && [[ ! -e "${NGINX_ENABLED_DIR}/${NGINX_CONF_NAME}.conf" ]]; then
    if [[ -w "$NGINX_ENABLED_DIR" ]]; then
      ln -sf "$NGINX_CONF_FILE" "${NGINX_ENABLED_DIR}/${NGINX_CONF_NAME}.conf"
    else
      sudo ln -sf "$NGINX_CONF_FILE" "${NGINX_ENABLED_DIR}/${NGINX_CONF_NAME}.conf"
    fi
    success "nginx site enabled via symlink"
  fi

  # Test config
  info "Testing nginx configuration ..."
  if command -v sudo &>/dev/null && [[ $EUID -ne 0 ]]; then
    sudo nginx -t || die "nginx config test failed — check ${NGINX_CONF_FILE}"
    sudo nginx -s reload
  else
    nginx -t || die "nginx config test failed — check ${NGINX_CONF_FILE}"
    nginx -s reload
  fi

  NGINX_INSTALLED="true"
  if [[ "$EXPOSE_PUBLIC" == "true" ]]; then
    success "nginx configured → 0.0.0.0:${NGINX_PORT} (public)"
  else
    success "nginx configured → 127.0.0.1:${NGINX_PORT} (localhost only)"
  fi
fi

# ─────────────────────────────────────────────
# Final output
# ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${GREEN}  Installation complete!${RESET}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# Show the URL Glance should use
if [[ "$NGINX_INSTALLED" == "true" ]]; then
  if [[ "$EXPOSE_PUBLIC" == "true" ]]; then
    WIDGET_ACCESS_URL="http://${NGINX_SERVER_NAME}:${NGINX_PORT}/"
  else
    WIDGET_ACCESS_URL="http://localhost:${NGINX_PORT}/"
  fi
  echo -e "  Widget URL (via nginx) : ${BOLD}${WIDGET_ACCESS_URL}${RESET}"
  echo -e "  Direct Node URL        : ${BOLD}http://127.0.0.1:${PORT}/${RESET}  (loopback only)"
else
  echo -e "  Widget URL  : ${BOLD}http://127.0.0.1:${PORT}/${RESET}  (loopback only)"
fi

echo -e "  Config      : ${BOLD}${ENV_FILE}${RESET}"
echo ""

# Service management commands
if [[ "$SERVICE_INSTALLED" == "true" ]]; then
  echo "  Service commands:"
  if [[ "$INIT_SYSTEM" == "systemd" ]]; then
    local_scope_flag=""
    [[ "$SYSTEMD_SCOPE" == "user" ]] && local_scope_flag=" --user"
    echo -e "    ${CYAN}systemctl${local_scope_flag} status  ${SERVICE_NAME}${RESET}"
    echo -e "    ${CYAN}systemctl${local_scope_flag} restart ${SERVICE_NAME}${RESET}"
    echo -e "    ${CYAN}systemctl${local_scope_flag} stop    ${SERVICE_NAME}${RESET}"
    echo -e "    ${CYAN}journalctl${local_scope_flag} -u ${SERVICE_NAME} -f${RESET}"
  elif [[ "$INIT_SYSTEM" == "launchd" ]]; then
    echo -e "    ${CYAN}launchctl stop  ${PLIST_LABEL}${RESET}"
    echo -e "    ${CYAN}launchctl start ${PLIST_LABEL}${RESET}"
    echo -e "    ${CYAN}tail -f ${LOG_DIR}/${SERVICE_NAME}.log${RESET}"
  fi
else
  echo "  Start manually:"
  echo -e "    ${CYAN}${LAUNCHER}${RESET}"
fi

# Nginx management commands
if [[ "$NGINX_INSTALLED" == "true" ]]; then
  echo ""
  echo "  Nginx commands:"
  echo -e "    ${CYAN}nginx -t${RESET}           test config"
  echo -e "    ${CYAN}nginx -s reload${RESET}    reload without downtime"
  echo -e "    ${CYAN}cat ${NGINX_CONF_FILE}${RESET}"
  if [[ "$EXPOSE_PUBLIC" == "true" ]]; then
    echo ""
    echo -e "  ${YELLOW}${BOLD}Access:${RESET} widget is reachable from other hosts on port ${NGINX_PORT}"
    echo -e "  ${YELLOW}Restrict access:${RESET} re-run install.sh and choose localhost-only"
  else
    echo ""
    echo -e "  ${GREEN}Access:${RESET} widget is ${BOLD}localhost-only${RESET} (safe default)"
    echo -e "  If Glance runs on a different host, re-run install.sh and choose public access"
    echo -e "  ${BOLD}or${RESET} add this server's IP to Glance's config manually."
  fi
fi

echo ""
echo "  Add to Glance (glance.yml):"
if [[ "$NGINX_INSTALLED" == "true" ]]; then
  echo -e "    ${CYAN}type: extension"
  echo -e "    url: ${WIDGET_ACCESS_URL}${RESET}"
else
  echo -e "    ${CYAN}type: extension"
  echo -e "    url: http://127.0.0.1:${PORT}/${RESET}"
  echo ""
  echo -e "  ${YELLOW}Note:${RESET} Glance must run on this machine for the loopback URL to work."
  echo -e "  Run install.sh again and configure nginx to expose it to other hosts."
fi
echo ""
