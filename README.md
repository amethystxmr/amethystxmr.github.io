# Amethyst XMR Monero wallet

Self-custodial Monero wallet in browser with multisig support

Open it here: https://amethystxmr.github.io

## Building wasm module

(check CI for the most up-to-date instructions)

```bash
cd monero-wasm-src
./init.sh
./build.sh
```

(If you have emsdk in your home folder then it will use it, docker overwise)

## C++ IDE support

VS Code/Cursor should use the `clangd` extension for C/C++ support. Install
`clangd-22` with:

```bash
npm run ide:install-clangd
```

The project still builds with Emscripten `em++`; the workspace clangd config
queries `em++` for the wasm target, sysroot, and headers.

The script installs `clangd-22` from apt, adding the https://apt.llvm.org/
repository if the package is not available from the current apt sources.
Ubuntu 22.04's default `clangd` package is too old for the current emsdk.

## E2E tests

Playwright drives the UI against a local `monerod` (started in `tests/global.setup.ts`).
Point to your binary when it is not on `PATH`:

```bash
MONEROD_PATH=~/monero-gui-v0.18.4.2/monerod ./node_modules/.bin/playwright test --headed basic
```

(`basic` matches `tests/basic_flow.spec.ts`.)

## Building web

```bash
npm run build

# or for local development
npm run dev
```

