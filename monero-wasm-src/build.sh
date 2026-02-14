#!/bin/bash
set -e 
 
mkdir -p built-wasm
mkdir -p built-wasm-emcache

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
    -w $(pwd)/built-wasm \
    emscripten/emsdk \
    sh -c "./build-wasm-cmds.sh" || error-beep
    
else
  echo "====== Bulding using local emsdk ======"
  source $EMSDK_DIR/emsdk_env.sh
  ./build-wasm-cmds.sh || error-beep
fi
       
# -DCMAKE_BUILD_TYPE=Debug
# -DCMAKE_BUILD_TYPE=Release

echo ""
echo ""

cp -v built-wasm/bin/monero-wasm-wallet.* ../monero-wasm-module/

echo ""
echo ""
echo ""
echo '=========================== Done ==========================='


canberra-gtk-play -i complete -l 2 || true
