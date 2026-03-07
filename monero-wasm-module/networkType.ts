export const NetworkType = {
  MAINNET: 0,
  TESTNET: 1,
  STAGENET: 2,
  FAKECHAIN: 3,
} as const;

export type NetworkType = (typeof NetworkType)[keyof typeof NetworkType];
