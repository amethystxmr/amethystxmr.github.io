#!/usr/bin/env bash
# Requirements:
# sudo apt update
# sudo apt install -y librsvg2-bin
# sudo apt install -y fonts-inter

set -euo pipefail

SOURCE_SVG="web-src/public/icons/source/amethyst-logo.svg"
OUTPUT_DIR="web-src/public/icons"
FAVICON="web-src/public/favicon.ico"
NATIVE_BUILD_DIR="build"
SIZES=(16 32 48 72 96 128 144 152 167 180 192 256 384 512)

render_png() {
  local size="$1"
  local out="$OUTPUT_DIR/icon-${size}x${size}.png"

  rsvg-convert -w "$size" -h "$size" "$SOURCE_SVG" -o "$out"
}

generate_icons() {
  local mode="${1:-all}"

  [[ -f "$SOURCE_SVG" ]] || { echo "Source logo not found: $SOURCE_SVG" >&2; exit 1; }
  command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert is required. Install: sudo apt install -y librsvg2-bin" >&2; exit 1; }
  mkdir -p "$OUTPUT_DIR"
  cp "$SOURCE_SVG" "$OUTPUT_DIR/icon.svg"

  case "$mode" in
    list)
      echo "${SIZES[*]}"
      ;;
    favicon)
      convert "$OUTPUT_DIR/icon-16x16.png" "$OUTPUT_DIR/icon-32x32.png" "$OUTPUT_DIR/icon-48x48.png" "$FAVICON"
      echo "Generated favicon.ico"
      ;;
    all)
      for s in "${SIZES[@]}"; do
        render_png "$s"
      done
      convert "$OUTPUT_DIR/icon-16x16.png" "$OUTPUT_DIR/icon-32x32.png" "$OUTPUT_DIR/icon-48x48.png" "$FAVICON"
      mkdir -p "$NATIVE_BUILD_DIR"
      cp "$OUTPUT_DIR/icon-512x512.png" "$NATIVE_BUILD_DIR/icon.png"
      convert \
        "$OUTPUT_DIR/icon-16x16.png" \
        "$OUTPUT_DIR/icon-32x32.png" \
        "$OUTPUT_DIR/icon-48x48.png" \
        "$OUTPUT_DIR/icon-128x128.png" \
        "$OUTPUT_DIR/icon-256x256.png" \
        "$NATIVE_BUILD_DIR/icon.ico"
      echo "Generated full icon set + favicon + native build icons"
      ;;
    *)
      if [[ "$mode" =~ ^[0-9]+$ ]] && (( mode > 0 )); then
        render_png "$mode"
        echo "Generated icon-${mode}x${mode}.png"
      else
        echo "Usage: $0 <all|favicon|list|size>" >&2
        exit 1
      fi
      ;;
  esac
}

generate_icons "${1:-all}"
