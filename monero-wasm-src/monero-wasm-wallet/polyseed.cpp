#include <stdio.h>
#include <emscripten.h>
#include <emscripten/bind.h>
#include "emscripten/proxying.h"

void keke()
{
    printf("KEKE\n");
}

EMSCRIPTEN_BINDINGS(monero_wasm_wallet_polyseed)
{
    emscripten::function(
        "keke", &keke);
}