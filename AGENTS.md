# Agent Instructions

## Coding

Be consistent with the code in this repository in all aspects, including structure, naming, formatting, error handling, comments, helper usage, abstraction level, simplicity, and similar conventions. Always try to find similar places and reuse the same pattern.

### Formatting

When editing TypeScript under `web-src`, `monero-wasm-module`, or `tests`, run Prettier on the changed files before completing the task. Use the full `npm run format:fix` script only when a broad reformat is intended. Generated `monero-wasm-module/wasm_wallet.*` files are excluded from formatting.

Before finishing work that touches those paths, run `npm run format:check` (or format only the files you changed) so CI does not fail on formatting.

When editing C++ Embind glue code in `monero-wasm-src/monero-wasm-wallet/wasm_wallet_api.cpp`, follow the style already used in that file for wrapper functions, naming, binding declarations, value conversions, and comments.

### TypeScript And React

- Always try to avoid typecasting.
- Follow this repository's existing code style for React components and state.

## Review Instructions

When reviewing changes in this repository, focus on the pull request diff and any directly related context needed to understand it. Ignore unrelated legacy issues outside the current change set.

Report only meaningful problems:
- correctness regressions
- broken behavior
- mismatched interfaces
- dangerous security or privacy issues
- clearly broken build or runtime logic

Do not fail the review for style preferences, naming preferences, or speculative refactors.

Always verify the full wallet API mapping surface, even if the diff only changes one side of it:
- Keep the C++ Embind surface in `monero-wasm-src/monero-wasm-wallet/wasm_wallet_api.cpp` aligned with the TypeScript API surface in `monero-wasm-module/walletApi.ts`.
- Also verify related worker exposure stays aligned across `monero-wasm-module/walletApi.worker.ts` and `monero-wasm-module/walletApi.workerClient.ts`.
- Check methods, enums, object fields, callback shapes, and return shapes, not just the changed lines.
- If any mismatch exists across those layers, report it even if only one side changed in the pull request.
- If UI code calls a wallet API method or reads a wallet API field that is missing or mismatched relative to the current TS/C++ bindings, report it.

Also flag:
- debug leftovers such as `console.log`, temporary prints, or ad hoc diagnostics introduced by the pull request
- leakage of sensitive wallet data, seeds, keys, or raw secrets through logs, UI, storage, or error messages
- newly introduced blocking or obviously unsafe logic in user-facing flows when surrounding code expects async or non-blocking behavior
- broken imports, exports, renamed symbols, or impossible control flow introduced by the pull request

## Cursor Cloud specific instructions

Vite reads the gitignored wallet engine at `monero-wasm-module/wasm_wallet.wasm` when it loads config. `npm run dev`, `npm run build`, and Playwright all need `monero-wasm-module/wasm_wallet.*`. Cloud Agent install copies those files from the successful GitHub Actions artifact `monero-wasm-module-Release` (the `Build` run for `HEAD` when that artifact exists, otherwise the latest successful `master` run). A copy is also kept at `/opt/amethyst-wasm` for the next boot. Rebuild from source with `monero-wasm-src/init.sh` and `monero-wasm-src/build.sh` when the C++ wallet changes.

Node.js 24.21.0, matching CI, is installed at `/usr/local/bin/node`. Prefix project commands with `export PATH="/usr/local/bin:$PATH"` so that binary is selected. `monerod` for end-to-end tests is `/usr/local/bin/monerod`. Playwright Chromium is installed with `npx playwright install --with-deps chromium`.

The dev server listens on port 5173: `npm run dev -- --host 0.0.0.0 --port 5173`. Playwright uses port 4173, so `npm run test:e2e` can run while that server is up. Canonical checks are `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`.

`tests/http_fetch_progress.spec.ts` expects an intermediate XHR progress event (`0 < loaded < total`) while `/getblocks.bin` downloads. On a fast loopback that body can arrive in one progress callback (`loaded == total`), so this spec can fail after the wallet has already synced. The other Playwright specs cover create, restore, send, and multisig against local `monerod`.
