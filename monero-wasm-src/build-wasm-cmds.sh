set -e

if [ -z "${BUILD_TYPE:-}" ]; then
  echo "Error: BUILD_TYPE is required"
  echo "Expected Debug or Release"
  exit 1
fi

case "$BUILD_TYPE" in
  Debug|Release)
    ;;
  *)
    echo "Error: unknown build type '$BUILD_TYPE'"
    echo "Expected Debug or Release"
    exit 1
    ;;
esac

BUILD_WASM_DIR="built-wasm-$BUILD_TYPE"
BUILD_EMCACHE_DIR="built-wasm-emcache-$BUILD_TYPE"
BUILD_DEPENDS_DIR="built-wasm-depends-$BUILD_TYPE"

mkdir -p "$BUILD_WASM_DIR"
mkdir -p "$BUILD_EMCACHE_DIR"
mkdir -p "$BUILD_DEPENDS_DIR"

export EM_CACHE="$(pwd)/$BUILD_EMCACHE_DIR"

emcmake cmake -B "$BUILD_WASM_DIR" \
    -DNO_AES=1 \
    -DUNBOUND_INCLUDE_DIR=$(pwd)/unbound-stub \
    -DUNBOUND_LIBRARIES=$(pwd)/unbound-stub \
    -DUSE_DEVICE_TREZOR=OFF \
    -DBUILD_DEPENDS_FOLDER="$BUILD_DEPENDS_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
    
emmake make -C "$BUILD_WASM_DIR" VERBOSE=1
