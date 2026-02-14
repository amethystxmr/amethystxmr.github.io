#!/bin/bash
set -e 

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

error-beep() {
    # Use this one-liner to play all the sounds
    # for f in /usr/share/sounds/freedesktop/stereo/*.oga; do name=$(basename "$f" .oga); echo "$name"; canberra-gtk-play -i "$name"; done
    canberra-gtk-play -i bell -l 3 >/dev/null 2>&1 || true
    return 1
}

if [ ! -d "$EMSDK_DIR" ]; then
  echo "====== Building using emscripten docker image ======"
  docker run \
    --rm \
    -v $(pwd):$(pwd) \
    -u $(id -u):$(id -g) \
    -e BUILD_TYPE="$BUILD_TYPE" \
    -w $(pwd) \
    emscripten/emsdk \
    sh -c "./build-wasm-cmds.sh" || error-beep
    
else
  echo "====== Bulding using local emsdk ======"
  source $EMSDK_DIR/emsdk_env.sh
  BUILD_TYPE="$BUILD_TYPE" ./build-wasm-cmds.sh || error-beep
fi
       
echo ""
echo ""

cp -v "$BUILD_WASM_DIR"/bin/monero-wasm-wallet.* ../monero-wasm-module/

echo ""
echo ""
echo ""
echo '=========================== Done ==========================='


canberra-gtk-play -i complete -l 2 || true
