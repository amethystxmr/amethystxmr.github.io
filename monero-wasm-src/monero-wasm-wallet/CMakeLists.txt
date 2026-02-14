project(MoneroWasmWallet)

set(monero_wasm_wallet_headers)


set(monero_wasm_wallet_sources
    main.cpp)

monero_find_all_headers(monero_wasm_wallet_private_headers "${CMAKE_CURRENT_SOURCE_DIR}")

monero_private_headers(monero_wasm_wallet
    ${monero_wasm_wallet_private_headers})

monero_add_executable(monero-wasm-wallet
    ${monero_wasm_wallet_sources}
    ${monero_wasm_wallet_headers}
    ${monero_wasm_wallet_private_headers}
)


target_link_libraries(monero-wasm-wallet
    PRIVATE
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
  SUFFIX ".mjs"
)