import {
  ENGLISH_WORDS,
  trimmedEnglishPrefix,
} from "./monero-english-words.ts";

/** Matches boost::crc_32_type used by Monero seed checksums. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function createChecksumIndex(dataWords: readonly string[]): number {
  if (dataWords.length === 0) {
    throw new Error("Cannot checksum an empty word list");
  }

  let trimmedWords = "";
  for (const word of dataWords) {
    if (!ENGLISH_WORDS.includes(word)) {
      throw new Error(`Unknown English seed word: ${word}`);
    }
    trimmedWords += trimmedEnglishPrefix(word);
  }

  const checksum = crc32(new TextEncoder().encode(trimmedWords));
  return checksum % dataWords.length;
}

/** Append the Monero checksum word to 24 data words. */
export function withMoneroChecksum(dataWords: readonly string[]): string[] {
  if (dataWords.length !== 24) {
    throw new Error(`Expected 24 data words, got ${dataWords.length}`);
  }

  const checksumIndex = createChecksumIndex(dataWords);
  return [...dataWords, dataWords[checksumIndex]];
}
