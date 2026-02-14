set -e

export EM_CACHE=$(pwd)/built-wasm-emcache

emcmake cmake -B built-wasm \
    -DNO_AES=1 \
    -DUNBOUND_INCLUDE_DIR=$(pwd)/unbound-stub \
    -DUNBOUND_LIBRARIES=$(pwd)/unbound-stub \
    -DUSE_DEVICE_TREZOR=OFF \
    -DCMAKE_BUILD_TYPE=Debug
    
emmake make -C built-wasm VERBOSE=1