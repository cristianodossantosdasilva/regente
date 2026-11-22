#!/usr/bin/env bash
# Roda todas as suítes E2E contra um app isolado (dados e WebView em pasta temporária; porta 9333).
# Uso: bash e2e/run-all.sh [caminho-do-regente-app.exe]   (padrão: target/release/regente-app.exe)
# Não mexe em instâncias já abertas: encerra apenas os processos que ESTE script iniciou.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXE="${1:-$ROOT/target/release/regente-app.exe}"
DATA="$ROOT/.local/e2e-run"
PORT=9333
cd "$ROOT/e2e"
total_fail=0
for suite in full nodes coord routines templates; do
  rm -rf "$DATA/appdata" 2>/dev/null; mkdir -p "$DATA/appdata" "$DATA/wv2"
  T="$(cygpath -w "$DATA")"
  export APPDATA="$T\\appdata" WEBVIEW2_USER_DATA_FOLDER="$T\\wv2" WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$PORT" E2E_PORT=$PORT
  before="$(powershell.exe -NoProfile -Command "(Get-Process regente-app -ErrorAction SilentlyContinue | ForEach-Object Id) -join ','" | tr -d '\r')"
  ("$EXE" >/dev/null 2>&1 &)
  sleep 9
  mine="$(powershell.exe -NoProfile -Command "\$b='$before'.Split(','); (Get-Process regente-app -ErrorAction SilentlyContinue | Where-Object { \$b -notcontains [string]\$_.Id } | ForEach-Object Id) -join ','" | tr -d '\r')"
  out="$(timeout 280 node "$suite.mjs" 2>&1)"
  echo "== $suite"; echo "$out" | grep -E "FAIL|verifica|OK$|Error" | head -8
  echo "$out" | grep -q "FAIL" && total_fail=$((total_fail+1))
  [ -n "$mine" ] && powershell.exe -NoProfile -Command "Stop-Process -Id ${mine//,/,} -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
  sleep 2
done
echo "suítes com falha: $total_fail"
exit $total_fail
