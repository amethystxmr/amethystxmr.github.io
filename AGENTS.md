# Codex Review Instructions

When reviewing changes in this repository, focus on the pull request diff and any directly related context needed to understand it. Ignore unrelated legacy issues outside the current change set.

Report only meaningful problems:
- correctness regressions
- broken behavior
- mismatched interfaces
- dangerous security or privacy issues
- clearly broken build or runtime logic

Do not fail the review for style preferences, naming preferences, or speculative refactors.

When editing frontend files under `web-src` or TypeScript wallet API files under `monero-wasm-module`, run `npm run format:fix` before completing the task. Generated `monero-wasm-module/wasm_wallet.*` files are excluded from formatting.

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
