#!/usr/bin/env bash
# Tailwind CSS 를 CDN 없이 파일로 빌드 (독립 실행 CLI — node 불필요)
#   scripts/build_css.sh <config.js> <input.css> <output.css>
# config 예시:
#   module.exports = { content: ['./app/templates/**/*.html', './app/static/*.js'], theme: { extend: {} }, plugins: [] };
# input.css:
#   @tailwind base; @tailwind components; @tailwind utilities;
# ⚠️ 새 클래스를 쓰면 다시 빌드. JS 에서 'bg-' + color 처럼 조립한 클래스는 빌드가 못 찾는다.
set -euo pipefail
CONFIG=${1:-tailwind.config.js}; INPUT=${2:-tailwind.input.css}; OUTPUT=${3:-static/vendor/tailwind.css}
BIN=.tools/tailwindcss
if [ ! -x "$BIN" ]; then
  mkdir -p .tools
  ARCH=$(uname -m); OS=$(uname -s | tr A-Z a-z)
  case "$ARCH" in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; esac
  [ "$OS" = "darwin" ] && OS=macos
  curl -fsSL -o "$BIN" "https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-$OS-$ARCH"
  chmod +x "$BIN"
fi
"$BIN" -c "$CONFIG" -i "$INPUT" -o "$OUTPUT" --minify
