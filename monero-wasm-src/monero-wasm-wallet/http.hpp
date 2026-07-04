#pragma once

#if defined(AMETHYST_WASM_THREADS)
#include "http-threads.hpp"
#else
#include "http-asyncify.hpp"
#endif
