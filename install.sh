#!/usr/bin/env bash
# install.sh — Install and start the Glance Beszel extension as a system service
#
# ── One-liner install ────────────────────────────────────────────────────────
#
#   Interactive:
#     curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash
#
#   Headless:
#     curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh \
#       | BESZEL_URL=http://192.168.1.5:8090 \
#         BESZEL_EMAIL=admin@example.com \
#         BESZEL_PASSWORD=secret \
#         bash -s -- --headless
#
# ── Required env vars ───────────────────────────────────────────────────────
#   BESZEL_URL       URL of your Beszel instance
#   BESZEL_EMAIL     Beszel admin e-mail
#   BESZEL_PASSWORD  Beszel admin password
#
# ── Optional env vars ───────────────────────────────────────────────────────
#   PORT             Port to listen on          default: 8088
#   INSTALL_DIR      Install directory          default: /opt/glance-beszel
#   SERVICE_NAME     Service name               default: glance-beszel
#
# ── Widget options (set in .env or as query params on the URL) ───────────────
#   WIDGET_TITLE     Title shown in Glance      default: Homelab
#   WIDGET_TITLE_URL URL the title links to     default: BESZEL_URL
#   SHOW_ALERTS      Show alert banner          default: true
#   COLLAPSE_AFTER   Collapse after N systems   default: 0
#   SYSTEM_FILTER    Comma-separated names      default: (all)
#   STATUS_FILTER    up / down / paused         default: (all)
#
#   Query param equivalents (override per-widget in glance.yml):
#     url: http://host:8088/?systems=pbs,nexus&status=up&collapse_after=3

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# BOOTSTRAP — auto-download when piped through curl | bash
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

  if command -v curl &>/dev/null; then
    curl -fsSL "$GITHUB_TARBALL" | tar -xz -C "$tmp_dir"
  elif command -v wget &>/dev/null; then
    wget -qO- "$GITHUB_TARBALL" | tar -xz -C "$tmp_dir"
  else
    echo "ERROR: neither curl nor wget is available. Install one and re-run." >&2
    exit 1
  fi

  local src_dir
  src_dir="$(find "$tmp_dir" -maxdepth 1 -mindepth 1 -type d | head -1)"
  trap - EXIT

  echo "==> Launching installer from ${src_dir} ..."
  exec bash "${src_dir}/install.sh" "$@" </dev/tty
}

_src="${BASH_SOURCE[0]:-}"
if [[ -z "$_src" || "$_src" == "bash" || "$_src" == "/dev/stdin" || "$_src" =~ ^/dev/fd/ ]]; then
  _bootstrap "$@"
  exit 1
fi
unset _src

# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}==>${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD} ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD} !${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}ERROR:${RESET} $*" >&2; exit 1; }

# ask_var VAR_NAME "Question" "default"
# Skips prompt if the variable is already set in the environment.
ask_var() {
  local varname="$1" question="$2" default="$3"
  local cur="${!varname:-}"
  # Already set — use it as-is, no prompt needed
  if [[ -n "$cur" ]]; then
    success "${question}: ${cur}"
    return
  fi
  # Headless with no value — fall back to default
  if [[ "$HEADLESS" == "true" ]]; then
    printf -v "$varname" '%s' "$default"
    return
  fi
  # Interactive prompt
  local shown="$default"
  echo -en "${BOLD}${question}${RESET}"
  [[ -n "$shown" ]] && echo -en " ${CYAN}[${shown}]${RESET}"
  echo -en ": "
  local inp; read -r inp </dev/tty
  printf -v "$varname" '%s' "${inp:-$shown}"
}

# ask_secret VAR_NAME "Question"  — masked input, required
# Skips prompt if the variable is already set in the environment.
ask_secret() {
  local varname="$1" question="$2"
  local cur="${!varname:-}"
  # Already set — no prompt
  if [[ -n "$cur" ]]; then
    success "${question}: [already set]"
    return
  fi
  # Headless with no value — error
  if [[ "$HEADLESS" == "true" ]]; then
    die "$varname must be set when running headless"
  fi
  # Interactive prompt
  echo -en "${BOLD}${question}${RESET}: "
  local inp; read -rs inp </dev/tty; echo
  [[ -n "$inp" ]] || die "$varname is required"
  printf -v "$varname" '%s' "$inp"
}

# ask_confirm "Question" [y|n]
ask_confirm() {
  local question="$1" default="${2:-y}"
  if [[ "$HEADLESS" == "true" ]]; then return 0; fi
  local hint="[Y/n]"; [[ "$default" == "n" ]] && hint="[y/N]"
  echo -en "${BOLD}${question}${RESET} ${CYAN}${hint}${RESET}: "
  local inp; read -r inp </dev/tty
  inp="${inp:-$default}"
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

USAGE:
  Interactive (recommended):
    curl -fsSL https://raw.githubusercontent.com/javedh-dev/glance-beszel/main/install.sh | bash

  Headless:
    BESZEL_URL=http://host:8090 BESZEL_EMAIL=a@b.com BESZEL_PASSWORD=secret \\
      bash install.sh --headless

INSTALLER ENV VARS:
  BESZEL_URL       Beszel instance URL          (required)
  BESZEL_EMAIL     Beszel admin e-mail          (required)
  BESZEL_PASSWORD  Beszel admin password        (required)
  PORT             Extension listen port        default: 8088
  INSTALL_DIR      Install directory            default: /opt/glance-beszel
  SERVICE_NAME     systemd/launchd name         default: glance-beszel

WIDGET SETTINGS (add to .env after install, or pass as query params):
  WIDGET_TITLE     Title in Glance              default: Homelab
  WIDGET_TITLE_URL URL the title links to       default: BESZEL_URL
  SHOW_ALERTS      Show alert banner            default: true
  COLLAPSE_AFTER   Collapse after N systems     default: 0
  SYSTEM_FILTER    Comma-separated names        default: (all)
  STATUS_FILTER    up / down / paused           default: (all)

  Query param examples:
    url: http://host:8088/?systems=pbs,nexus
    url: http://host:8088/?status=up&collapse_after=3
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
# Node.js
# ─────────────────────────────────────────────

NODE_TARGET_MAJOR=20

_install_node_linux() {
  info "Installing Node.js ${NODE_TARGET_MAJOR} LTS ..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_TARGET_MAJOR}.x" | sudo -E bash -
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
    _install_node_nvm; return
  fi
  info "Installing Node.js via Homebrew ..."
  brew install node@${NODE_TARGET_MAJOR}
  export PATH="$(brew --prefix)/opt/node@${NODE_TARGET_MAJOR}/bin:${PATH}"
}

_install_node_nvm() {
  info "Installing Node.js via nvm ..."
  local nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
  if [[ ! -s "${nvm_dir}/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck source=/dev/null
  source "${nvm_dir}/nvm.sh"
  nvm install "${NODE_TARGET_MAJOR}"
  nvm use "${NODE_TARGET_MAJOR}"
  export PATH="${nvm_dir}/versions/node/$(nvm version)/bin:${PATH}"
}

check_node() {
  if command -v node &>/dev/null; then
    local ver major
    ver="$(node --version)"
    major="${ver#v}"; major="${major%%.*}"
    if (( major >= 18 )); then
      success "Node.js ${ver}"; return
    fi
    warn "Node.js ${ver} is too old (need 18+) — installing ${NODE_TARGET_MAJOR}"
  else
    warn "Node.js not found — installing ${NODE_TARGET_MAJOR} LTS"
  fi

  if [[ "$HEADLESS" != "true" ]]; then
    ask_confirm "Install Node.js ${NODE_TARGET_MAJOR} LTS now?" "y" || \
      die "Node.js is required. Install manually from https://nodejs.org"
  fi

  [[ "$OS" == "Linux" ]]  && _install_node_linux
  [[ "$OS" == "Darwin" ]] && _install_node_brew
  [[ "$OS" != "Linux" && "$OS" != "Darwin" ]] && _install_node_nvm

  command -v node &>/dev/null || die "Node.js installation failed."
  success "Node.js $(node --version) installed"
}

# ─────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}   Glance Beszel Extension — Installer${RESET}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
[[ "$HEADLESS" == "true" ]] && warn "Headless mode — reading settings from environment"

check_node

# ─────────────────────────────────────────────
# Install location (ask first so we can load existing .env as defaults)
# ─────────────────────────────────────────────

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Install Location ───────────────────────────${RESET}"
ask_var INSTALL_DIR  "Install directory" "/opt/glance-beszel"
ask_var SERVICE_NAME "Service name"      "glance-beszel"

# Load existing .env as defaults — only for vars not already in environment
ENV_FILE="${INSTALL_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  info "Loading existing .env as defaults"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*) ]]; then
      local_key="${BASH_REMATCH[1]}"
      local_val="${BASH_REMATCH[2]}"
      if [[ -z "${!local_key+x}" ]]; then
        export "$local_key"="$local_val"
      fi
    fi
  done < "$ENV_FILE"
fi

# ─────────────────────────────────────────────
# Gather: essentials only
# ─────────────────────────────────────────────

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Beszel Connection ──────────────────────────${RESET}"
ask_var    BESZEL_URL      "Beszel URL"      "http://localhost:8090"
ask_secret BESZEL_EMAIL    "Beszel e-mail"
ask_secret BESZEL_PASSWORD "Beszel password"

echo ""
[[ "$HEADLESS" != "true" ]] && echo -e "${BOLD}── Extension ──────────────────────────────────${RESET}"
ask_var PORT "Listen port" "8088"

# ─────────────────────────────────────────────
# Summary + confirm
# ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}── Summary ─────────────────────────────────────${RESET}"
echo -e "  Install dir  : ${BOLD}${INSTALL_DIR}${RESET}"
echo -e "  Service name : ${BOLD}${SERVICE_NAME}${RESET}"
echo -e "  Init system  : ${BOLD}${INIT_SYSTEM}${RESET}"
echo -e "  Beszel URL   : ${BOLD}${BESZEL_URL}${RESET}"
echo -e "  Listen port  : ${BOLD}${PORT}${RESET}"
echo ""

ask_confirm "Proceed with installation?" || { echo "Aborted."; exit 0; }

# ─────────────────────────────────────────────
# Copy source files
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
  success "Running from source — skipping copy"
fi

# ─────────────────────────────────────────────
# Write .env
# ─────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak"
  warn "Existing .env backed up → ${ENV_FILE}.bak"
fi

cat > "$ENV_FILE" <<EOF
# Glance Beszel Extension — generated by install.sh $(date)
# Edit this file to reconfigure, then restart the service.
# Re-run install.sh at any time to reconfigure interactively.

# ── Required ─────────────────────────────────
BESZEL_URL=${BESZEL_URL}
BESZEL_EMAIL=${BESZEL_EMAIL}
BESZEL_PASSWORD=${BESZEL_PASSWORD}

# ── Server ───────────────────────────────────
PORT=${PORT}

# ── Widget appearance (optional) ─────────────
# These can also be overridden per-widget via query params:
#   url: http://host:${PORT}/?systems=pbs,nexus&status=up&collapse_after=3
#
#WIDGET_TITLE=Homelab
#WIDGET_TITLE_URL=${BESZEL_URL}
#SHOW_ALERTS=true
#COLLAPSE_AFTER=0
#SYSTEM_FILTER=
#STATUS_FILTER=
EOF

chmod 600 "$ENV_FILE"
success ".env written (mode 600)"

# ─────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────

info "Installing npm dependencies and building ..."
(
  cd "$INSTALL_DIR"
  npm install 2>&1 | grep -v "^npm warn" || true
  npm run build
  npm prune --omit=dev 2>&1 | grep -v "^npm warn" || true
)
success "Build complete"

# ─────────────────────────────────────────────
# Launcher script
# ─────────────────────────────────────────────

LAUNCHER="${INSTALL_DIR}/start.sh"
cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/usr/bin/env bash
# Auto-generated by install.sh — re-run install.sh to regenerate
set -euo pipefail
cd "${INSTALL_DIR}"
set -o allexport
source "${ENV_FILE}"
set +o allexport
exec node "${INSTALL_DIR}/dist/index.js"
LAUNCHER_EOF

chmod +x "$LAUNCHER"
success "Launcher: ${LAUNCHER}"

# ─────────────────────────────────────────────
# Register service
# ─────────────────────────────────────────────

NODE_BIN="$(command -v node)"
SERVICE_INSTALLED="false"
SYSTEMD_SCOPE="system"

# ── systemd ──────────────────────────────────
if [[ "$INIT_SYSTEM" == "systemd" ]]; then

  SYSTEMD_DIR="/etc/systemd/system"
  USE_SUDO=""

  if [[ $EUID -ne 0 ]]; then
    if [[ "$HEADLESS" == "true" ]] || ask_confirm "Not running as root. Install as user systemd service?"; then
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
  } > "/tmp/${SERVICE_NAME}.service.tmp"

  if [[ "$SYSTEMD_SCOPE" == "system" ]]; then
    $USE_SUDO cp "/tmp/${SERVICE_NAME}.service.tmp" "$UNIT_FILE"
    $USE_SUDO systemctl daemon-reload
    $USE_SUDO systemctl enable  "${SERVICE_NAME}.service"
    $USE_SUDO systemctl restart "${SERVICE_NAME}.service"
  else
    cp "/tmp/${SERVICE_NAME}.service.tmp" "$UNIT_FILE"
    systemctl --user daemon-reload
    systemctl --user enable  "${SERVICE_NAME}.service"
    systemctl --user restart "${SERVICE_NAME}.service"
  fi
  rm -f "/tmp/${SERVICE_NAME}.service.tmp"
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
  <key>Label</key>       <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${LAUNCHER}</string>
  </array>
  <key>WorkingDirectory</key> <string>${INSTALL_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:$(dirname "$NODE_BIN")</string>
  </dict>
  <key>RunAtLoad</key>  <true/>
  <key>KeepAlive</key>  <true/>
  <key>StandardOutPath</key>  <string>${LOG_DIR}/${SERVICE_NAME}.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/${SERVICE_NAME}.err.log</string>
</dict>
</plist>
PLIST

  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  launchctl load -w "$PLIST_FILE"
  SERVICE_INSTALLED="true"
  success "launchd agent '${PLIST_LABEL}' loaded"

# ── none ─────────────────────────────────────
else
  warn "No init system detected — service NOT registered."
  warn "Start manually: ${LAUNCHER}"
fi

# ─────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${GREEN}  Installation complete!${RESET}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Extension URL : ${BOLD}http://$(hostname -f 2>/dev/null || hostname):${PORT}/${RESET}"
echo -e "  Config        : ${BOLD}${ENV_FILE}${RESET}"
echo ""

if [[ "$SERVICE_INSTALLED" == "true" ]]; then
  echo "  Service management:"
  if [[ "$INIT_SYSTEM" == "systemd" ]]; then
    local_scope_flag=""; [[ "$SYSTEMD_SCOPE" == "user" ]] && local_scope_flag=" --user"
    echo -e "    ${CYAN}systemctl${local_scope_flag} status  ${SERVICE_NAME}${RESET}"
    echo -e "    ${CYAN}systemctl${local_scope_flag} restart ${SERVICE_NAME}${RESET}"
    echo -e "    ${CYAN}journalctl${local_scope_flag} -u ${SERVICE_NAME} -f${RESET}"
  elif [[ "$INIT_SYSTEM" == "launchd" ]]; then
    echo -e "    ${CYAN}launchctl stop  ${PLIST_LABEL}${RESET}"
    echo -e "    ${CYAN}launchctl start ${PLIST_LABEL}${RESET}"
    echo -e "    ${CYAN}tail -f ${LOG_DIR}/${SERVICE_NAME}.log${RESET}"
  fi
else
  echo -e "  Start: ${CYAN}${LAUNCHER}${RESET}"
fi

echo ""
echo "  Add to Glance (glance.yml):"
echo -e "    ${CYAN}type: extension"
echo -e "    url: http://<this-host>:${PORT}/${RESET}"
echo ""
