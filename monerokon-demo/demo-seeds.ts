import {
  createChecksumIndex,
  withMoneroChecksum,
} from "./monero-seed-checksum.ts";

/** Filler word used for every word after the index marker (including checksum). */
export const DEMO_SEED_FILLER_WORD = "zero";

/** Number of filler words after the index marker in the 24 data words. */
export const DEMO_SEED_TRAILING_FILLER_COUNT = 23;

/** Supported demo wallet indexes (0..8). */
export const DEMO_SEED_INDEX_COUNT = 9;

/**
 * Preferred index marker words for MoneroKon demo wallets (travel / conference theme).
 * If a word would make the checksum non-filler, the next candidate is tried.
 */
export const DEMO_SEED_INDEX_WORDS = [
  "hotel",
  "airport",
  "metro",
  "taxi",
  "ticket",
  "coffee",
  "pizza",
  "phone",
  "video",
] as const;

/** Extra fallback markers, tried after the travel words. */
const DEMO_SEED_FALLBACK_INDEX_WORDS = [
  "money",
  "water",
  "paper",
  "robot",
  "lucky",
  "earth",
  "moon",
  "omega",
  "second",
] as const;

function buildDataWords(indexWord: string, fillerWord: string): string[] {
  return [
    indexWord,
    ...Array.from({ length: DEMO_SEED_TRAILING_FILLER_COUNT }, () => fillerWord),
  ];
}

function checksumWordForDataWords(
  dataWords: readonly string[],
  fillerWord: string,
): string | null {
  const checksumIndex = createChecksumIndex(dataWords);
  const checksumWord = dataWords[checksumIndex];
  return checksumWord === fillerWord ? checksumWord : null;
}

function indexWordCandidates(index: number): string[] {
  const preferred = DEMO_SEED_INDEX_WORDS[index];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const word of [
    preferred,
    ...DEMO_SEED_INDEX_WORDS,
    ...DEMO_SEED_FALLBACK_INDEX_WORDS,
  ]) {
    if (seen.has(word)) {
      continue;
    }
    seen.add(word);
    candidates.push(word);
  }

  return candidates;
}

export function resolveDemoIndexWord(
  index: number,
  fillerWord: string = DEMO_SEED_FILLER_WORD,
): string {
  for (const indexWord of indexWordCandidates(index)) {
    const dataWords = buildDataWords(indexWord, fillerWord);
    if (checksumWordForDataWords(dataWords, fillerWord) !== null) {
      return indexWord;
    }
  }

  throw new Error(
    `No index marker word found for demo seed ${index} with filler "${fillerWord}"`,
  );
}

export function getDemoSeed(
  index: number,
  options: { fillerWord?: string } = {},
): string {
  if (!Number.isInteger(index) || index < 0 || index >= DEMO_SEED_INDEX_COUNT) {
    throw new Error(
      `Demo seed index must be an integer from 0 to ${DEMO_SEED_INDEX_COUNT - 1}`,
    );
  }

  const fillerWord = options.fillerWord ?? DEMO_SEED_FILLER_WORD;
  const indexWord = resolveDemoIndexWord(index, fillerWord);
  const dataWords = buildDataWords(indexWord, fillerWord);

  return withMoneroChecksum(dataWords).join(" ");
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return entryPath.endsWith("demo-seeds.ts");
}

if (isMainModule()) {
  for (let index = 0; index < DEMO_SEED_INDEX_COUNT; index += 1) {
    console.log(`${index}:`);
    console.log(getDemoSeed(index));
    console.log("");
  }
}
