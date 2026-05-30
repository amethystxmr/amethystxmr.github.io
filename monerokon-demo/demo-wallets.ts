import {
  DEMO_SEED_SET_COUNT,
  DEMO_SEED_SET_SIZE,
  getDemoSeed,
  getDemoSeedSet,
} from "./demo-seeds.ts";
import { loadWalletApi } from "./wallet-shims.ts";

const DEMO_WALLET_PASSWORD = "";
const MULTISIG_THRESHOLD = 2;
const MULTISIG_PARTICIPANTS = 3;
const MULTISIG_SET_COUNT = DEMO_SEED_SET_COUNT;

type WalletApi = Awaited<ReturnType<typeof loadWalletApi>>;
type MoneroWasmWallet = Awaited<
  ReturnType<WalletApi["createWallet"]>
>;

function seedIndexesForSet(setIndex: number): [number, number, number] {
  const base = setIndex * DEMO_SEED_SET_SIZE;
  return [base, base + 1, base + 2];
}

async function restoreWalletFromSeed(
  walletApi: WalletApi,
  seed: string,
  walletName: string,
): Promise<MoneroWasmWallet> {
  const wallet = await walletApi.createWallet(walletApi.NetworkTypes.MAINNET);
  await wallet.init();

  const secret32 = await wallet.words_to_bytes(seed, "English");
  if (!secret32 || secret32.length !== 32) {
    await wallet.delete();
    throw new Error(`Invalid demo seed for wallet "${walletName}"`);
  }

  await wallet.generate(
    walletName,
    DEMO_WALLET_PASSWORD,
    secret32,
    true,
    false,
  );
  await wallet.rewrite(walletName, DEMO_WALLET_PASSWORD);
  await wallet.store();
  return wallet;
}

async function closeWallet(
  walletApi: WalletApi,
  wallet: MoneroWasmWallet,
  walletName: string,
): Promise<void> {
  try {
    await wallet.delete();
  } finally {
    walletApi.deleteWalletFiles(walletName);
  }
}

async function createDemoMultisigSet(
  walletApi: WalletApi,
  setIndex: number,
): Promise<{
  seeds: [string, string, string];
  address: string;
  exchangeRounds: number;
}> {
  const seedIndexes = seedIndexesForSet(setIndex);
  const seeds = seedIndexes.map((index) => getDemoSeed(index)) as [
    string,
    string,
    string,
  ];
  const walletNames = seedIndexes.map(
    (index) => `monerokon-demo-set${setIndex}-seed${index}`,
  ) as [string, string, string];

  const wallets: MoneroWasmWallet[] = [];
  try {
    for (let participant = 0; participant < MULTISIG_PARTICIPANTS; participant += 1) {
      wallets.push(
        await restoreWalletFromSeed(
          walletApi,
          seeds[participant],
          walletNames[participant],
        ),
      );
    }

    const round1Messages: string[] = [];
    for (const wallet of wallets) {
      await wallet.enable_multisig(true);
      round1Messages.push(await wallet.prepare_multisig());
    }

    let kexMessages: string[] = [];
    for (const wallet of wallets) {
      kexMessages.push(
        await wallet.make_multisig(
          DEMO_WALLET_PASSWORD,
          round1Messages,
          MULTISIG_THRESHOLD,
        ),
      );
    }

    let exchangeRounds = 0;
    let status = await wallets[0].get_multisig_status();
    while (!status.is_ready) {
      exchangeRounds += 1;
      if (exchangeRounds > 10) {
        throw new Error(
          `Set #${setIndex} did not finalize within 10 exchange rounds`,
        );
      }

      const nextMessages: string[] = [];
      for (const wallet of wallets) {
        nextMessages.push(
          await wallet.exchange_multisig_keys(
            DEMO_WALLET_PASSWORD,
            kexMessages,
          ),
        );
      }
      kexMessages = nextMessages;
      status = await wallets[0].get_multisig_status();
    }

    const addresses = await Promise.all(wallets.map((wallet) => wallet.get_address()));
    const uniqueAddresses = new Set(addresses);
    if (uniqueAddresses.size !== 1) {
      throw new Error(
        `Set #${setIndex} participants disagree on address: ${addresses.join(", ")}`,
      );
    }

    return {
      seeds,
      address: addresses[0],
      exchangeRounds,
    };
  } finally {
    await Promise.all(
      wallets.map((wallet, participant) =>
        closeWallet(walletApi, wallet, walletNames[participant]),
      ),
    );
  }
}

export async function getDemoMultisigSet(setIndex: number): Promise<{
  seeds: [string, string, string];
  address: string;
}> {
  if (
    !Number.isInteger(setIndex) ||
    setIndex < 0 ||
    setIndex >= MULTISIG_SET_COUNT
  ) {
    throw new Error(
      `Demo multisig set index must be an integer from 0 to ${MULTISIG_SET_COUNT - 1}`,
    );
  }

  const walletApi = await loadWalletApi();
  const result = await createDemoMultisigSet(walletApi, setIndex);
  return {
    seeds: result.seeds,
    address: result.address,
  };
}

function formatDemoMultisigSetOutput(
  setIndex: number,
  seeds: readonly [string, string, string],
  address: string,
): string[] {
  const { theme } = getDemoSeedSet(setIndex);
  return [
    `Set #${setIndex} (${theme}):`,
    seeds[0],
    seeds[1],
    seeds[2],
    address,
    "",
  ];
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return entryPath.endsWith("demo-wallets.ts");
}

if (isMainModule()) {
  const walletApi = await loadWalletApi();
  const outputLines: string[] = [];

  for (let setIndex = 0; setIndex < MULTISIG_SET_COUNT; setIndex += 1) {
    const { seeds, address } = await createDemoMultisigSet(walletApi, setIndex);
    const blockLines = formatDemoMultisigSetOutput(setIndex, seeds, address);
    outputLines.push(...blockLines);
    console.log(blockLines.join("\n"));
  }

  console.log(`\n${"-".repeat(30)}\n${outputLines.join("\n")}`);
}
