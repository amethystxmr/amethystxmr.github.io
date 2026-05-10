#!/usr/bin/env bash
set -euo pipefail

# Cursor uses clangd for IDE features, but this repo builds C++ through
# Emscripten's em++ driver. The workspace config makes clangd query em++ for
# wasm headers and flags. clangd must be close to the emsdk LLVM version;
# Ubuntu 22.04's default clangd 14 is too old for the current emsdk.
CLANGD_VERSION=22
CLANGD_PACKAGE="clangd-$CLANGD_VERSION"

[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || {
  echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2
  exit 1
}

if ! apt-cache show "$CLANGD_PACKAGE" >/dev/null 2>&1; then
  . /etc/os-release
  CODENAME="${VERSION_CODENAME:?Missing VERSION_CODENAME in /etc/os-release}"
  LLVM_LIST="/etc/apt/sources.list.d/llvm-toolchain-$CODENAME-$CLANGD_VERSION.list"

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -d -m 0755 /etc/apt/keyrings

  if [ ! -f /etc/apt/keyrings/apt.llvm.org.gpg ]; then
    curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key \
      | sudo gpg --dearmor -o /etc/apt/keyrings/apt.llvm.org.gpg
  fi

  echo "deb [signed-by=/etc/apt/keyrings/apt.llvm.org.gpg] https://apt.llvm.org/$CODENAME/ llvm-toolchain-$CODENAME-$CLANGD_VERSION main" \
    | sudo tee "$LLVM_LIST" >/dev/null
  sudo apt-get update
fi

sudo apt-get install -y "$CLANGD_PACKAGE"

echo "$CLANGD_PACKAGE: $(command -v "$CLANGD_PACKAGE")"
"$CLANGD_PACKAGE" --version | sed -n '1,3p'

CLANGD_MAJOR="$("$CLANGD_PACKAGE" --version | sed -n 's/.*version \([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [ "$CLANGD_MAJOR" != "$CLANGD_VERSION" ]; then
  echo "Expected clangd $CLANGD_VERSION, got: ${CLANGD_MAJOR:-unknown}" >&2
  exit 1
fi
