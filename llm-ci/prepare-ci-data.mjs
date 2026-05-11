/**
 * Runs before `agent.mjs` in CI: reads `---LLM_CI_DATA_FILES---` paths from the prompt
 * and writes any paths that have a generator here. Prompt policy stays in prompt.txt;
 * this file only holds “how to build artifact X” for paths the footer references.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePromptPath, splitPromptDataFiles } from "./prompt_util.mjs";

/** @type {Record<string, (workspaceRoot: string) => void>} */
const GENERATORS = {
  "llm-ci/embind-wallet.functions.txt"(workspaceRoot) {
    const cpp = join(workspaceRoot, "monero-wasm-src/monero-wasm-wallet/wasm_wallet_api.cpp");
    const src = readFileSync(cpp, "utf8");
    const names = new Set();
    for (const line of src.split(/\r?\n/)) {
      const needle = '.function("';
      const idx = line.indexOf(needle);
      if (idx === -1) continue;
      const rest = line.slice(idx + needle.length);
      const end = rest.indexOf('"');
      if (end === -1) continue;
      names.add(rest.slice(0, end));
    }
    const body = `${[...names].sort().join("\n")}\n`;
    if (!body.trim()) {
      throw new Error("embind-wallet.functions.txt would be empty");
    }
    const outPath = join(workspaceRoot, "llm-ci/embind-wallet.functions.txt");
    writeFileSync(outPath, body);
    process.stderr.write(`prepare-ci-data: wrote llm-ci/embind-wallet.functions.txt (${names.size} names)\n`);
  },
};

function main() {
  const workspaceRoot = (process.env.LLM_CI_WORKSPACE || process.cwd()).replace(/\/+$/, "");
  const raw = readFileSync(resolvePromptPath(), "utf8");
  const { dataFiles } = splitPromptDataFiles(raw);
  if (dataFiles.length === 0) {
    process.stderr.write("prepare-ci-data: no data file paths in prompt footer (nothing to do)\n");
    return;
  }
  for (const rel of dataFiles) {
    const key = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    const gen = GENERATORS[key];
    if (gen) {
      gen(workspaceRoot);
      continue;
    }
    const abs = join(workspaceRoot, key);
    if (existsSync(abs)) {
      process.stderr.write(`prepare-ci-data: skip ${key} (exists, no generator)\n`);
    } else {
      process.stderr.write(
        `prepare-ci-data: warning: ${key} is listed but missing and has no generator in prepare-ci-data.mjs\n`,
      );
    }
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
}
