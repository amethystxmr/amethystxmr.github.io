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
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        message(STATUS "======================== Debug build ========================")
        set(EMSCRIPTEN_DEBUG_OPTIONS -g -O0)
        set(EMSCRIPTEN_DEBUG_OPTIONS_LINKER -gseparate-dwarf -gsource-map)
    else()
        message(STATUS "======================== Release build ========================")
        set(EMSCRIPTEN_DEBUG_OPTIONS -O3)
        set(EMSCRIPTEN_DEBUG_OPTIONS_LINKER)
    endif()


    # TODO: Check, can we remove NO_DISABLE_EXCEPTION_CATCHING?
    add_compile_options(
        ${EMSCRIPTEN_DEBUG_OPTIONS}
        -sUSE_PTHREADS=0
        -DBOOST_ASIO_DISABLE_THREADS
        -DBOOST_HAS_THREADS
        -DBOOST_HAS_PTHREADS
        -DBOOST_THREAD_POSIX
        -sNO_DISABLE_EXCEPTION_CATCHING
    )

    add_link_options(
        ${EMSCRIPTEN_DEBUG_OPTIONS}
        ${EMSCRIPTEN_DEBUG_OPTIONS_LINKER}
        -sNO_DISABLE_EXCEPTION_CATCHING
        -sINITIAL_MEMORY=800MB
        -sSTACK_SIZE=10MB
        -sUSE_PTHREADS=0
        -sENVIRONMENT=web,worker
        -sASYNCIFY=1
        -sASYNCIFY_STACK_SIZE=1048576
        "-sASYNCIFY_IMPORTS=['js_http_request']"
        -sWEBSOCKET_URL=ws://localhost:4444
        -sALLOW_MEMORY_GROWTH=1
        -sSINGLE_FILE=1
        -sWASM_BIGINT=1
        -sEXPORT_ES6=1
        -sEXPORT_NAME=MoneroWasmWallet
        -Wl,--error-limit=0
        -lembind
        -lidbfs.js
        -sFORCE_FILESYSTEM=1
        -sEXPORTED_RUNTIME_METHODS=['FS','IDBFS']
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

# Monero's upstream translation generator is not available when cross-compiling
# (it expects IMPORT_EXECUTABLES from a native build). For the wasm wallet we
# don't need embedded Qt `.qm` assets, but Monero core still includes
# `translation_files.h`. Provide a minimal stub header so `i18n.cpp` compiles.
set(TRANSLATIONS_HEADER "${MONERO_GENERATED_HEADERS_DIR}/translation_files.h")
file(WRITE "${TRANSLATIONS_HEADER}" [==[
#ifndef TRANSLATION_FILES_H
#define TRANSLATION_FILES_H

#include <string>

static const struct embedded_file {
  const std::string *name;
  const std::string *data;
} embedded_files[] = {
  {NULL, NULL}
};

static bool find_embedded_file(const std::string &name, std::string &data) {
  (void)name;
  (void)data;
  return false;
}

#endif /* TRANSLATION_FILES_H */
]==])
add_custom_target(generate_translations_header)

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

# Ensure ExternalProject-built headers/libraries are available before compiling
# Monero core objects that include them. Otherwise, parallel builds may try to
# compile sources before the ExternalProject install step finishes.
if(EMSCRIPTEN)
    if(TARGET obj_cncrypto AND TARGET libsodium_ep)
        add_dependencies(obj_cncrypto libsodium_ep)
    endif()
    if(TARGET obj_cryptonote_core AND TARGET zeromq_ep)
        add_dependencies(obj_cryptonote_core zeromq_ep)
    endif()
    if(TARGET obj_epee AND TARGET openssl_ep)
        add_dependencies(obj_epee openssl_ep)
    endif()
endif()
