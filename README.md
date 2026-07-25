# Amethyst XMR Monero wallet

Self-custodial Monero wallet in browser with multisig support

Open it here: https://amethystxmr.github.io

## Building wasm module

(check CI for the most up-to-date instructions)

The wallet has two WASM builds:

- `Asyncify`: single-threaded fallback build. Works without `SharedArrayBuffer`.
- `Threads`: pthreads build. Used when the browser has cross-origin isolation and
  `SharedArrayBuffer`.

Build both variants before building the web frontend:

```bash
cd monero-wasm-src
./init.sh
./build.sh Release Asyncify
./build.sh Release Threads
```

(If you have emsdk in your home folder then it will use it, docker overwise)

For local development, use `Debug` instead of `Release` if needed:

```bash
./build.sh Debug Asyncify
./build.sh Debug Threads
```

Generated artifacts are copied into `monero-wasm-module/` with variant-specific
names:

- `wasm_wallet_asyncify.mjs` / `wasm_wallet_asyncify.wasm`
- `wasm_wallet_threads.mjs` / `wasm_wallet_threads.wasm`

The build directories, Emscripten cache directories, and dependency directories
are also variant-specific, e.g. `built-wasm-Release-Asyncify` and
`built-wasm-Release-Threads`.

## C++ IDE support

VSCode/Cursor should use the `clangd` extension for C/C++ support. Install
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

Playwright drives the production web build against a local `monerod` (started in
`tests/global.setup.ts`).
Point to your binary when it is not on `PATH`:

```bash
MONEROD_PATH=~/monero-gui-v0.18.4.2/monerod ./node_modules/.bin/playwright test --headed basic
```

(`basic` matches `tests/basic_flow.spec.ts`.)

The WASM variant matrix lives in `tests/wasm_variant_matrix.spec.ts` and checks
the four preview environments:

| Server COI headers | Service workers | Expected WASM variant |
| ------------------ | --------------- | --------------------- |
| no                 | blocked         | Asyncify              |
| yes                | blocked         | Threads               |
| no                 | allowed         | Threads               |
| yes                | allowed         | Threads               |

Run only the variant matrix with:

```bash
npm run test:e2e -- tests/wasm_variant_matrix.spec.ts
```

## Sync performance bench

Mainnet restore/sync benchmark. One restore height = current tip −
`BENCH_HEIGHT_DIFF` (default **20160** ≈ 4 weeks at 720 blocks/day).
`BENCH_RUNS` (default **10**) repeats the full matrix. Execution order is
**run → daemon → variant**; summary/JSON rows are grouped as
**daemon → variant → run** (run1, run2, … under each cell).

**Local** runs the full matrix; **Cake** only runs `asyncify`, `threads4`,
and `native0` (all cores).

| Variant    | What it runs                                              |
| ---------- | --------------------------------------------------------- |
| `asyncify` | WASM Asyncify build                                       |
| `thread1`  | WASM Threads with pthread pool size forced to 1           |
| `threads`  | WASM Threads (full `navigator.hardwareConcurrency`)       |
| `threads2` | WASM Threads with pthread pool size forced to 2           |
| `threads4` | WASM Threads with pthread pool size forced to 4           |
| `native0`  | `./bin/monero-wallet-cli --max-concurrency 0` (all cores) |
| `native1`  | `./bin/monero-wallet-cli --max-concurrency 1`             |
| `native2`  | `./bin/monero-wallet-cli --max-concurrency 2`             |
| `native4`  | `./bin/monero-wallet-cli --max-concurrency 4`             |

`--max-concurrency` is the correct Monero CLI option. Value `0` means all
cores (`tools::set_max_concurrency` treats `n < 1` as
`boost::thread::hardware_concurrency()`).

Not part of CI e2e.

### Prerequisites

1. Production WASM + web build (both variants):

```bash
cd monero-wasm-src && ./init.sh && ./build.sh Release Threads && ./build.sh Release Asyncify && cd .. && npm run build && echo All_Ok
```

2. Local `monerod` already running and **synced** on mainnet at
   `http://localhost:18081` (the bench only verifies it; it does not start monerod).
3. Network access to Cake: `https://xmr-node.cakewallet.com:18081`.
4. Playwright Chromium installed: `npm run test:e2e:install`.
5. Official `monero-wallet-cli` in `./bin` (gitignored). Download:

```bash
mkdir -p bin && cd bin && curl -fL -o monero.tar.bz2 "https://downloads.getmonero.org/cli/linux64" && tar -xjf monero.tar.bz2 && CLI=$(find . -maxdepth 2 -type f -name monero-wallet-cli | head -n 1) && test -n "$CLI" && cp "$CLI" ./monero-wallet-cli && chmod +x monero-wallet-cli && rm -rf monero.tar.bz2 monero-*-linux-gnu* && cd .. && ./bin/monero-wallet-cli --version
```

Optional: `BENCH_WALLET_CLI_PATH=/path/to/monero-wallet-cli` to override.

### Run

Runs **headed by default** (Chromium window + native CLI in a terminal
emulator when `DISPLAY`/`WAYLAND_DISPLAY` is set). There is no GUI for
`monero-wallet-cli`; headed native means a visible terminal. Force headless
with `BENCH_HEADLESS=1`. Optional: `BENCH_TERMINAL=gnome-terminal` (or
`xterm` / `konsole`). Daemon filter: `BENCH_DAEMONS=local` or `local,cake`.
Variant filter: `BENCH_VARIANTS=native` / `wasm`, or a comma list such as
`native0,native4`.

Each WASM cell launches a **fresh Chromium** (closed afterward) so a compositor
crash cannot kill the rest of the matrix. Headed Chromium defaults to
`--ozone-platform=x11` because long Wayland sessions often die with
`Fatal Wayland communication error: Connection reset by peer`. Override with
`BENCH_CHROMIUM_OZONE=wayland` or `auto`.

```bash
npm run bench:sync
```

Smoke / ~1 hour (30 blocks ≈ 720/day), 1 run:

```bash
BENCH_HEIGHT_DIFF=30 BENCH_RUNS=1 npm run bench:sync
```

Local only (skip Cake):

```bash
BENCH_DAEMONS=local BENCH_HEIGHT_DIFF=30 BENCH_RUNS=1 npm run bench:sync
```

Local native only (`native0`/`native1`/`native2`/`native4`):

```bash
BENCH_DAEMONS=local BENCH_VARIANTS=native BENCH_HEIGHT_DIFF=30 BENCH_RUNS=1 npm run bench:sync
```

Headless:

```bash
BENCH_HEADLESS=1 BENCH_HEIGHT_DIFF=30 BENCH_RUNS=1 npm run bench:sync
```

Smoke / ~1 day (720 blocks), 2 runs:

```bash
BENCH_HEIGHT_DIFF=720 BENCH_RUNS=2 npm run bench:sync
```

Other overrides:

```bash
BENCH_SEED="dogs zero ..." BENCH_HEIGHT_DIFF=20160 BENCH_RUNS=10 BENCH_DAEMON_LOCAL="http://localhost:18081" BENCH_DAEMON_REMOTE="https://xmr-node.cakewallet.com:18081" BENCH_TIMEOUT_MS=14400000 npm run bench:sync
```

Progress prints during each cell. Console output is appended (not rewritten)
to `tests/bench/results/sync-perf-YYYY-MM-DD_HH-MM-SS.txt`; structured JSON
is updated after each cell under the matching `.json` name. Each invocation
uses a new timestamp so older runs are kept.

CPU / traffic columns:

- `cpuWorkSec`: total CPU-seconds (WASM: page renderer incl. worker/pthreads;
  native: CLI process via `/proc`)
- `avgCores`: `cpuWorkSec / wallSec` (parallelism)
- `rxMiB` / `txMiB` (native only): from CLI `net_stats` (`bytes received` /
  `bytes sent` over the daemon HTTP client)
- `workers` (WASM only): `page.workers().length` after sync
  (includes the primary wallet worker)

## Building web

```bash
npm run build

# or for local development
npm run dev
```

`npm run dev` serves COOP/COEP headers so the Threads build can run locally.
In Vite development builds, wallet concurrency defaults to `1` thread so the
threaded WASM build does not consume all CPU cores on a developer machine.

In production, startup chooses the WASM variant dynamically:

- if the page is cross-origin isolated and `SharedArrayBuffer` is available,
  load `Threads`
- otherwise, in production with service worker support, register the service
  worker and reload so same-origin responses get COOP/COEP headers
- if isolation is still unavailable, fall back to `Asyncify`

The Options screen lets users choose no threading, a fixed thread count, or all
reported CPU cores. In production, the unchanged default is the largest fixed
option up to `4` that does not exceed `navigator.hardwareConcurrency`.
