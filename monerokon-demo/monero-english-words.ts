import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGLISH_H_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../monero-wasm-src/monero/src/mnemonics/english.h",
);

/** Monero English mnemonic word list (1626 words). */
export const ENGLISH_WORDS: readonly string[] = loadEnglishWords();

/** English seed words are checksummed using a 3-character prefix. */
export const ENGLISH_UNIQUE_PREFIX_LENGTH = 3;

function loadEnglishWords(): readonly string[] {
  const source = readFileSync(ENGLISH_H_PATH, "utf8");
  const blockMatch = source.match(
    /static constexpr const char \* const words\[NWORDS\] =\s*\{([\s\S]*?)\};/,
  );
  if (!blockMatch) {
    throw new Error(`Failed to parse word list from ${ENGLISH_H_PATH}`);
  }

  const words = [...blockMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (words.length !== 1626) {
    throw new Error(`Expected 1626 English seed words, got ${words.length}`);
  }

  return words;
}

export function trimmedEnglishPrefix(word: string): string {
  if (word.length <= ENGLISH_UNIQUE_PREFIX_LENGTH) {
    return word;
  }
  return word.slice(0, ENGLISH_UNIQUE_PREFIX_LENGTH);
}
