cmake_minimum_required(VERSION 3.10)

project(ProjectName)

set(CMAKE_C_STANDARD 11)
# Monero core currently builds under C++14; monero-wasm-wallet opts into C++17 in its own target.
set(CMAKE_CXX_STANDARD 14)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)


message(STATUS "EMSCRIPTEN='${EMSCRIPTEN}'")
message(STATUS "CMAKE_SYSTEM_NAME='${CMAKE_SYSTEM_NAME}'")
message(STATUS "CMAKE_C_COMPILER='${CMAKE_C_COMPILER}'")
message(STATUS "CMAKE_CXX_COMPILER='${CMAKE_CXX_COMPILER}'")
message(STATUS "CMAKE_TOOLCHAIN_FILE='${CMAKE_TOOLCHAIN_FILE}'")


if(EMSCRIPTEN)
    set(AMETHYST_WASM_VARIANT "${AMETHYST_WASM_VARIANT}" CACHE STRING "WASM build variant: Asyncify or Threads")
    if(NOT AMETHYST_WASM_VARIANT)
        message(FATAL_ERROR "AMETHYST_WASM_VARIANT is required: Asyncify or Threads")
    endif()
    if(NOT AMETHYST_WASM_VARIANT STREQUAL "Asyncify" AND NOT AMETHYST_WASM_VARIANT STREQUAL "Threads")
        message(FATAL_ERROR "Unknown AMETHYST_WASM_VARIANT='${AMETHYST_WASM_VARIANT}', expected Asyncify or Threads")
    endif()
    message(STATUS "======================== WASM variant: ${AMETHYST_WASM_VARIANT} ========================")

    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        message(STATUS "======================== Debug build ========================")
        set(EMSCRIPTEN_COMPILE_OPTIONS -g -O0)
        set(EMSCRIPTEN_LINK_OPTIONS -g -O0)
        set(EMSCRIPTEN_DEBUG_OPTIONS_LINKER -gseparate-dwarf -gsource-map)
    else()
        message(STATUS "======================== Release build ========================")
        # Fast generated code, but link for size: large wasm parse/compile cost was
        # hurting the browser; monero-ts uses -Oz similarly.
        set(EMSCRIPTEN_COMPILE_OPTIONS -O3)
        set(EMSCRIPTEN_LINK_OPTIONS -Oz)
        set(EMSCRIPTEN_DEBUG_OPTIONS_LINKER)
    endif()

    set(AMETHYST_WASM_COMPILE_OPTIONS)
    set(AMETHYST_WASM_LINK_OPTIONS)
    if(AMETHYST_WASM_VARIANT STREQUAL "Threads")
        add_compile_definitions(AMETHYST_WASM_THREADS=1)
        list(APPEND AMETHYST_WASM_COMPILE_OPTIONS
            -sUSE_PTHREADS=1
        )
        list(APPEND AMETHYST_WASM_LINK_OPTIONS
            -sUSE_PTHREADS=1
            # One extra pthread is reserved for the dedicated HTTP fetch/progress worker.
            # Monero's compute pool may still use up to hardwareConcurrency - 1 workers.
            "-sPTHREAD_POOL_SIZE=((navigator.hardwareConcurrency||2)+1)"
            -sPTHREAD_POOL_SIZE_STRICT=1
        )
    else()
        list(APPEND AMETHYST_WASM_LINK_OPTIONS
            # Async HTTP (XHR) yields via EM_ASYNC_JS; Embind awaits completion (libembind_asyncify).
            -sASYNCIFY
            # Wallet/daemon stacks are deep during refresh/RPC chains.
            -sASYNCIFY_STACK_SIZE=131072
        )
    endif()

    # pthread API is required for Boost.Asio / threadpool headers even in a
    # single-threaded WASM link (no -sUSE_PTHREADS).
    add_compile_options(
        ${EMSCRIPTEN_COMPILE_OPTIONS}
        ${AMETHYST_WASM_COMPILE_OPTIONS}
        -pthread
        -sNO_DISABLE_EXCEPTION_CATCHING
    )

    add_link_options(
        ${EMSCRIPTEN_LINK_OPTIONS}
        ${EMSCRIPTEN_DEBUG_OPTIONS_LINKER}
        -pthread
        -sNO_DISABLE_EXCEPTION_CATCHING
        # Do NOT set a huge INITIAL_MEMORY: reserving hundreds of MB at
        # instantiation OOMs/crashes Chrome tabs. Grow from a small heap instead
        # (monero-ts relies on ALLOW_MEMORY_GROWTH without multi-hundred-MB starts).
        ${AMETHYST_WASM_LINK_OPTIONS}
        -sINITIAL_MEMORY=64MB
        -sSTACK_SIZE=5MB
        -sWEBSOCKET_URL=ws://localhost:4444
        -sALLOW_MEMORY_GROWTH=1
        -sWASM_BIGINT=1
        -sENVIRONMENT=worker
        -sEXPORT_ES6=1
        -sEXPORT_NAME=MoneroWasmWallet
        -Wl,--error-limit=0
        -lembind
        -lidbfs.js
        -sFORCE_FILESYSTEM=1
        -sEXPORTED_RUNTIME_METHODS=['FS','IDBFS','getExceptionMessage','decrementExceptionRefcount']
    )

    include_directories(SYSTEM "${CMAKE_SOURCE_DIR}/unbound-stub")

else()
    message(STATUS "===== Not using emscripten =====")

    set(ARCH_ID "x86_64")
endif()

include(${CMAKE_SOURCE_DIR}/ContribDepends.cmake)


function(die msg)
    if(NOT WIN32)
        string(ASCII 27 Esc)
        set(ColourReset "${Esc}[m")
        set(BoldRed "${Esc}[1;31m")
    else()
        set(ColourReset "")
        set(BoldRed "")
    endif()

    message(FATAL_ERROR "${BoldRed}${msg}${ColourReset}")
endfunction()

set(MONERO_GENERATED_HEADERS_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated_include")
include_directories(${MONERO_GENERATED_HEADERS_DIR})

list(INSERT CMAKE_MODULE_PATH 0
    "${CMAKE_SOURCE_DIR}/monero/cmake")





# TODO: detect 32 vs 64 bit properly
if(EMSCRIPTEN)
    set(ARCH_WIDTH "32")
elseif(CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(ARCH_WIDTH "64")
else()
    set(ARCH_WIDTH "32")
endif()

include(${CMAKE_SOURCE_DIR}/MoneroMacros.cmake)

include(${CMAKE_SOURCE_DIR}/monero/external/supercop/functions.cmake)

option(NO_AES "Explicitly disable AES support" ${NO_AES})

if(NO_AES)
    message(STATUS "AES support explicitly disabled")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -DNO_AES")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DNO_AES")
elseif(NOT ARM AND NOT PPC64LE AND NOT PPC64 AND NOT PPC AND NOT S390X AND NOT RISCV AND NOT LOONGARCH)
    message(STATUS "AES support enabled")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -maes")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -maes")
endif()

add_definitions(-DAUTO_INITIALIZE_EASYLOGGINGPP)

include_directories(
    ${CMAKE_SOURCE_DIR}/monero/external/rapidjson/include
    ${CMAKE_SOURCE_DIR}/monero/external/easylogging++
    ${CMAKE_SOURCE_DIR}/monero/src
    ${CMAKE_SOURCE_DIR}/monero/contrib/epee/include
    ${CMAKE_SOURCE_DIR}/monero/external/supercop/include
    ${CMAKE_SOURCE_DIR}/monero/external
)

add_custom_target(generate_translations_header)
include_directories(${CMAKE_SOURCE_DIR}/monero/translations/build)

include(${CMAKE_SOURCE_DIR}/monero/cmake/Version.cmake)
monero_add_library(version SOURCES ${CMAKE_BINARY_DIR}/version.cpp DEPENDS genversion)


add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/contrib/epee
    ${CMAKE_BINARY_DIR}/monero/epee
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/external
    ${CMAKE_BINARY_DIR}/monero/external
)

include_directories(${LMDB_INCLUDE})

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/crypto
    ${CMAKE_BINARY_DIR}/monero/crypto
)


add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/rpc
    ${CMAKE_BINARY_DIR}/monero/rpc
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/common
    ${CMAKE_BINARY_DIR}/monero/common
)


add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/cryptonote_core
    ${CMAKE_BINARY_DIR}/monero/cryptonote_core
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/net
    ${CMAKE_BINARY_DIR}/monero/net
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/daemonizer
    ${CMAKE_BINARY_DIR}/monero/daemonizer
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/blockchain_db
    ${CMAKE_BINARY_DIR}/monero/blockchain_db
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/cryptonote_basic
    ${CMAKE_BINARY_DIR}/monero/cryptonote_basic
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/ringct
    ${CMAKE_BINARY_DIR}/monero/ringct
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/checkpoints
    ${CMAKE_BINARY_DIR}/monero/checkpoints
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/device
    ${CMAKE_BINARY_DIR}/monero/device
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/hardforks
    ${CMAKE_BINARY_DIR}/monero/hardforks
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/multisig
    ${CMAKE_BINARY_DIR}/monero/multisig
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/mnemonics
    ${CMAKE_BINARY_DIR}/monero/mnemonics
)

add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/device_trezor
    ${CMAKE_BINARY_DIR}/monero/device_trezor
)

# We need this for linking
add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/wallet
    ${CMAKE_BINARY_DIR}/monero/wallet
)


# This is not needed for the library, but it is nice
# to have it in compile_commands.json for intellisense
add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero/src/simplewallet
    ${CMAKE_BINARY_DIR}/monero/simplewallet
)


add_subdirectory(
    ${CMAKE_SOURCE_DIR}/monero-wasm-wallet
)
