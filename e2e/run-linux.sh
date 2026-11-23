#!/usr/bin/env bash
# E2E de interface no Linux (e, em princípio, macOS) com WebDriver: sobe uma tela virtual (Xvfb), o `tauri-driver`
# e roda e2e/webdriver/smoke.mjs (broker/CLI) e features.mjs (nós, rotinas, templates, importação, persistência) contra o app. Dados e socket ficam em pastas temporárias (não toca nos seus).
#
# Pré-requisitos (Ubuntu/Debian):  sudo apt install webkit2gtk-driver xvfb xauth
#                                  cargo install tauri-driver --locked
# Antes:   npm ci && cargo build -p regente-cli && npx tauri build --debug --no-bundle
# Uso:     bash e2e/run-linux.sh [caminho/do/regente-app]     (padrão: target/debug/regente-app)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/target/debug/regente-app}"
[ -x "$APP" ] || { echo "app não encontrado: $APP"; exit 2; }
[ -x "$(dirname "$APP")/regente" ] || { echo "falta o CLI ao lado do app: rode 'cargo build -p regente-cli'"; exit 2; }
# O WebKitWebDriver pode estar fora do PATH (depende do pacote/distribuição).
if ! command -v WebKitWebDriver >/dev/null; then
  for d in /usr/lib/*/webkit2gtk-4.1 /usr/lib/*/webkit2gtk-4.0 /usr/lib/webkit2gtk-4.1 /usr/libexec/webkit2gtk-4.1; do
    [ -x "$d/WebKitWebDriver" ] && export PATH="$d:$PATH" && break
  done
fi
command -v tauri-driver >/dev/null || { echo "tauri-driver não instalado (cargo install tauri-driver --locked)"; exit 2; }
command -v WebKitWebDriver >/dev/null || { echo "WebKitWebDriver não instalado (apt install webkit2gtk-driver, ou webkitgtk-webdriver em Ubuntu mais novo)"; exit 2; }

export XDG_RUNTIME_DIR="$(mktemp -d)"; chmod 700 "$XDG_RUNTIME_DIR"
export XDG_DATA_HOME="$(mktemp -d)"
export E2E_ROOT="${E2E_ROOT:-$(mktemp -d)}"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
cd "$ROOT/e2e/webdriver"
xvfb-run -a -s "-screen 0 1920x1080x24" bash -c '
  tauri-driver >/tmp/tauri-driver.log 2>&1 &
  DRV=$!
  sleep 3
  node smoke.mjs "$0"
  CODE=$?
  node features.mjs "$0" || CODE=1
  kill $DRV 2>/dev/null
  exit $CODE
' "$APP"
