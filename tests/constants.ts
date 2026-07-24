export const APP_HOST = "127.0.0.1";
export const APP_PORT = 4173;
export const APP_URL = `http://${APP_HOST}:${APP_PORT}`;

export const MONEROD_RPC_HOST = "127.0.0.1";
export const MONEROD_RPC_PORT = 28081;
export const MONEROD_P2P_PORT = 28080;
export const MONEROD_RPC_URL = `http://${MONEROD_RPC_HOST}:${MONEROD_RPC_PORT}`;

export const MONERO_MINING_ADDRESS =
  "467y3cWwEMRikyE3LedE1xhdB41d31ZHn3EQrsvxrvvmYu3zcT32JtRguFeAvmhmquRpVEWHYExTd4d5x9RDPQRzGVxDT1z";

export const MONERO_RESTORE_SEED =
  "verification italics saved under upper fetches answers masterful general sickness ounce narrate joining cuddled faxed pledge touchy zippers turnip nephew renting dedicated fibula gecko verification";

/** Keys for MONERO_RESTORE_SEED; used by from-keys restore e2e tests (fixed expected values). */
export const FROM_KEYS_TEST_ADDRESS = MONERO_MINING_ADDRESS;
export const FROM_KEYS_TEST_PRIVATE_VIEW_KEY =
  "f203054a5ef7a9a5e1571ec85ceaf3a56f27a7df82d5e3a6974ca2cac39e1b02";
export const FROM_KEYS_TEST_PRIVATE_SPEND_KEY =
  "30632053d948eb6065d924cf58235aef191b1c1d1e1f20212223242526272809";

/**
 * Separate recipient used by integrated-address send e2e.
 * Standard address + integrated form (payment id `a1b2c3d4e5f60718`).
 */
export const INTEGRATED_RECIPIENT_ADDRESS =
  "495GrgpYzeb71ZRuToqEqY7TuWfP1VUFo3By6MYNBbbs3TvD18y3sGR7VFiGXysB8mP6buGVu9FqL9d33kpC25p7SsfWLAo";
export const INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS =
  "4JmwsVe3bv771ZRuToqEqY7TuWfP1VUFo3By6MYNBbbs3TvD18y3sGR7VFiGXysB8mP6buGVu9FqL9d33kpC25p7fQiSa892pWJ3jWe4zU";
export const INTEGRATED_RECIPIENT_PAYMENT_ID = "a1b2c3d4e5f60718";
export const INTEGRATED_RECIPIENT_PRIVATE_VIEW_KEY =
  "38442adf4c5763585c5068d6ed7e4f56e2dba4c6234ef4dfbfb6fafe296a020f";
export const INTEGRATED_RECIPIENT_PRIVATE_SPEND_KEY =
  "07bbeae694dfa243069bf9abe9d5f2a9e5f7a1c4b8d2e6f0a3c7b9d1e4f6a800";
