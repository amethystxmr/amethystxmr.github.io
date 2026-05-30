import {
  createChecksumIndex,
  withMoneroChecksum,
} from "./monero-seed-checksum.ts";

/** Filler word used for every word after the index marker (including checksum). */
export const DEMO_SEED_FILLER_WORD = "zero";

/** Number of filler words after the index marker in the 24 data words. */
export const DEMO_SEED_TRAILING_FILLER_COUNT = 23;

/** Demo seeds per multisig set. */
export const DEMO_SEED_SET_SIZE = 3;

/** Number of themed demo seed sets. */
export const DEMO_SEED_SET_COUNT = 4;

/** Total demo seed indexes (0..11). */
export const DEMO_SEED_INDEX_COUNT =
  DEMO_SEED_SET_COUNT * DEMO_SEED_SET_SIZE;

/**
 * Themed demo seed sets. Each seed is `{marker} zero zero ... zero` (25 words).
 * Every set shares the same filler/checksum word (`zero`).
 */
export const DEMO_SEED_SETS = [
  {
    theme: "animals",
    words: ["dogs", "wolf", "foxes"],
  },
  {
    theme: "food",
    words: ["coffee", "pizza", "lemon"],
  },
  {
    theme: "travel",
    words: ["hotel", "airport", "taxi"],
  },
  {
    theme: "nature",
    words: ["moon", "earth", "water"],
  },
] as const;

/** Flat list of preferred index marker words, derived from `DEMO_SEED_SETS`. */
export const DEMO_SEED_INDEX_WORDS = DEMO_SEED_SETS.flatMap(
  (set) => set.words,
) as unknown as readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** Extra fallback markers, tried after themed words in the same set. */
const DEMO_SEED_FALLBACK_INDEX_WORDS = [
  "hawk",
  "owls",
  "fruit",
  "metro",
  "ticket",
  "phone",
  "video",
  "autumn",
  "robot",
  "paper",
  "money",
  "lucky",
] as const;

export function getDemoSeedSetIndex(seedIndex: number): number {
  if (
    !Number.isInteger(seedIndex) ||
    seedIndex < 0 ||
    seedIndex >= DEMO_SEED_INDEX_COUNT
  ) {
    throw new Error(
      `Demo seed index must be an integer from 0 to ${DEMO_SEED_INDEX_COUNT - 1}`,
    );
  }
  return Math.floor(seedIndex / DEMO_SEED_SET_SIZE);
}

export function getDemoSeedIndexInSet(seedIndex: number): number {
  getDemoSeedSetIndex(seedIndex);
  return seedIndex % DEMO_SEED_SET_SIZE;
}

export function getDemoSeedSet(seedSetIndex: number) {
  if (
    !Number.isInteger(seedSetIndex) ||
    seedSetIndex < 0 ||
    seedSetIndex >= DEMO_SEED_SET_COUNT
  ) {
    throw new Error(
      `Demo seed set index must be an integer from 0 to ${DEMO_SEED_SET_COUNT - 1}`,
    );
  }
  return DEMO_SEED_SETS[seedSetIndex];
}

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

function indexWordCandidates(seedIndex: number): string[] {
  const set = getDemoSeedSet(getDemoSeedSetIndex(seedIndex));
  const preferred = set.words[getDemoSeedIndexInSet(seedIndex)];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const word of [
    preferred,
    ...set.words,
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
  seedIndex: number,
  fillerWord: string = DEMO_SEED_FILLER_WORD,
): string {
  for (const indexWord of indexWordCandidates(seedIndex)) {
    const dataWords = buildDataWords(indexWord, fillerWord);
    if (checksumWordForDataWords(dataWords, fillerWord) !== null) {
      return indexWord;
    }
  }

  throw new Error(
    `No index marker word found for demo seed ${seedIndex} with filler "${fillerWord}"`,
  );
}

export function getDemoSeed(
  seedIndex: number,
  options: { fillerWord?: string } = {},
): string {
  getDemoSeedSetIndex(seedIndex);

  const fillerWord = options.fillerWord ?? DEMO_SEED_FILLER_WORD;
  const indexWord = resolveDemoIndexWord(seedIndex, fillerWord);
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
  for (let setIndex = 0; setIndex < DEMO_SEED_SET_COUNT; setIndex += 1) {
    const set = getDemoSeedSet(setIndex);
    console.log(`Set #${setIndex} (${set.theme}):`);

    for (let offset = 0; offset < DEMO_SEED_SET_SIZE; offset += 1) {
      const seedIndex = setIndex * DEMO_SEED_SET_SIZE + offset;
      console.log(`${seedIndex}:`);
      console.log(getDemoSeed(seedIndex));
      console.log("");
    }
  }
}
