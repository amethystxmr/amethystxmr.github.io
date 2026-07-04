#!/bin/bash
set -e

cd "$(dirname "$0")"

BUILD_TYPE="${1:-Debug}"
case "$BUILD_TYPE" in
  Debug|Release)
    ;;
  *)
    echo "Error: unknown build type '$BUILD_TYPE'"
    echo "Usage: $0 [Debug|Release]"
    exit 1
    ;;
esac

BUILD_WASM_DIR="built-wasm-$BUILD_TYPE"

EMSDK_DIR=$HOME/emsdk
EMSCRIPTEN_VERSION="${EMSCRIPTEN_VERSION:-6.0.2}"

error-beep() {
    # Use this one-liner to play all the sounds
    # for f in /usr/share/sounds/freedesktop/stereo/*.oga; do name=$(basename "$f" .oga); echo "$name"; canberra-gtk-play -i "$name"; done
    canberra-gtk-play -i bell -l 3 >/dev/null 2>&1 || true
    return 1
}

echo "====== Building monero-wasm (build type: $BUILD_TYPE) ======"


if [ ! -d "$EMSDK_DIR" ]; then
  echo "====== Building using emscripten docker image ======"
  docker run \
    --rm \
    -v $(pwd):$(pwd) \
    -u $(id -u):$(id -g) \
    -e BUILD_TYPE="$BUILD_TYPE" \
    -w $(pwd) \
    "emscripten/emsdk:$EMSCRIPTEN_VERSION" \
    sh -c "./build-wasm-cmds.sh" || error-beep
    
else
  echo "====== Bulding using local emsdk ======"
  "$EMSDK_DIR/emsdk" install "$EMSCRIPTEN_VERSION"
  "$EMSDK_DIR/emsdk" activate "$EMSCRIPTEN_VERSION"
  source $EMSDK_DIR/emsdk_env.sh
  BUILD_TYPE="$BUILD_TYPE" ./build-wasm-cmds.sh || error-beep
fi
       
echo ""
echo ""

cp -v "$BUILD_WASM_DIR"/bin/wasm_wallet.* ../monero-wasm-module/

# Point clangd at whichever built-wasm-*/compile_commands.json was regenerated
# most recently (CMake re-runs configure on every invocation, so the freshest
# db is always the one for the build that just finished). Symlink lives next to
# this script so upward-search from monero-wasm-src/** finds it; drop the old
# workspace-root symlink if present.
LATEST_DB=$(ls -t built-wasm-*/compile_commands.json 2>/dev/null | head -n1)
if [ -n "$LATEST_DB" ]; then
  rm -f ../compile_commands.json
  ln -sfn "$LATEST_DB" compile_commands.json
  echo "Symlinked monero-wasm-src/compile_commands.json -> $LATEST_DB"
fi

echo ""
echo ""
echo ""
echo '=========================== Done ==========================='


canberra-gtk-play -i complete -l 2 || true
