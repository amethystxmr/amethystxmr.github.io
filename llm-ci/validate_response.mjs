#!/usr/bin/env node
/**
 * Validate LLM CI stdout: exactly OK, or one or more FAIL: lines — nothing else.
 * Exit 0 if valid, 1 otherwise.
 */
import { readFileSync } from "node:fs";

const filePath = process.argv[2] ?? "response.txt";

let raw;
try {
  raw = readFileSync(filePath, "utf8");
} catch (err) {
  console.error(`LLM CI: cannot read ${filePath}: ${err.message}`);
  process.exit(1);
}

const lines = raw
  .split(/\n/)
  .map((ln) => ln.trim())
  .filter((ln) => ln.length > 0);

if (lines.length === 0) {
  console.error("LLM CI: empty or whitespace-only model output.");
  process.exit(1);
}

if (lines.length === 1 && lines[0] === "OK") {
  process.exit(0);
}

if (lines.some((ln) => ln === "OK")) {
  console.error("LLM CI: OK must be the only non-empty line.");
  process.exit(1);
}

const failRe = /^FAIL:/;
for (const ln of lines) {
  if (!failRe.test(ln)) {
    console.error(
      `LLM CI: invalid line (expected OK alone or only FAIL: lines): ${JSON.stringify(ln)}`,
    );
    process.exit(1);
  }
}

process.exit(0);
