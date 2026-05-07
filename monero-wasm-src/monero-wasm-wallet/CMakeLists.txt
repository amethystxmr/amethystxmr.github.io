project(MoneroWasmWallet)

set(monero_wasm_wallet_headers)

if(CMAKE_VERSION VERSION_LESS 3.11)
    message(FATAL_ERROR "polyseed integration requires CMake 3.11+ (FetchContent)")
endif()

include(FetchContent)
FetchContent_Declare(
    polyseed
    GIT_REPOSITORY https://github.com/MrCyjaneK/polyseed.git
    GIT_TAG bd79f5014c331273357277ed8a3d756fb61b9fa1
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(polyseed)

set(monero_wasm_wallet_sources
    wasm_wallet_api.cpp
    polyseed.cpp
)

monero_find_all_headers(monero_wasm_wallet_private_headers "${CMAKE_CURRENT_SOURCE_DIR}")

monero_private_headers(monero_wasm_wallet
    ${monero_wasm_wallet_private_headers})

monero_add_executable(monero-wasm-wallet
    ${monero_wasm_wallet_sources}
    ${monero_wasm_wallet_headers}
    ${monero_wasm_wallet_private_headers}
)
target_compile_features(monero-wasm-wallet PRIVATE cxx_std_17)
# Keep this while building with older Boost on libc++/C++17:
# Boost may still reference std::unary_function/std::binary_function, removed in C++17.
target_compile_definitions(monero-wasm-wallet PRIVATE _LIBCPP_ENABLE_CXX17_REMOVED_UNARY_BINARY_FUNCTION)

target_include_directories(monero-wasm-wallet
    PRIVATE
    ${polyseed_SOURCE_DIR}/include
)


target_link_libraries(monero-wasm-wallet
    PRIVATE
    polyseed
    wallet
    rpc_base
    cryptonote_core
    cncrypto
    common
    mnemonics
    ${EPEE_READLINE}
    qrcodegen
    version
    ${Boost_CHRONO_LIBRARY}
    ${Boost_PROGRAM_OPTIONS_LIBRARY}
    ${Boost_FILESYSTEM_LIBRARY}
    ${Boost_LOCALE_LIBRARY}
    ${ICU_LIBRARIES}
    ${Boost_THREAD_LIBRARY}
    ${CMAKE_THREAD_LIBS_INIT}
    ${GNU_READLINE_LIBRARY}
    ${EXTRA_LIBRARIES})

install(TARGETS monero-wasm-wallet DESTINATION bin)

set_target_properties(monero-wasm-wallet PROPERTIES
    OUTPUT_NAME wasm_wallet
    SUFFIX ".mjs"
)
