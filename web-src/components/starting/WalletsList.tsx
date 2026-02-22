import * as React from "react";
import JSZip from "jszip";
import {
  Button,
  ButtonsHolder,
  ConfirmByTextDialog,
  Toggle,
  Header,
  Input,
  InputWithAction,
  Label,
  ListRowButton,
  OverlayDialog,
  Select,
  FormRow,
  SectionPanel,
  SurfaceCard,
  TextArea,
  useAlert,
} from "../ui";
import {
  createWallet,
  decodePolyseed,
  deleteWalletFiles,
  getMaxConcurrency,
  getWalletFilesData,
  getRecommendedMaxConcurrency,
  isWalletFileExists,
  listWalletNames,
  MoneroWasmWallet,
  renameWallet,
  saveWalletFilesData,
  setMaxConcurrency,
} from "../../../monero-wasm-module/walletApi";
import { WalletMain } from "../main";
import { ProgressBar } from "../ui";
import { DAEMON_PRESET_OPTIONS, options } from "../options";
import { NiceTabs } from "../main/tabs";
import { acquireWalletOpenLock, downloadBlob, withFsLock } from "../utils";

type OpenedWallet = {
  wallet: MoneroWasmWallet;
  releaseWalletOpenLock: () => void;
};

const DAEMON_CUSTOM_OPTION = "__custom__";
const TEMP_DAEMON_TEST_WALLET_PREFIX = "__daemon_test__";

type DaemonTestStatus = "idle" | "testing" | "ok" | "failed";

function getDaemonSelectValue(daemonAddress: string): string {
  return DAEMON_PRESET_OPTIONS.includes(
    daemonAddress as (typeof DAEMON_PRESET_OPTIONS)[number],
  )
    ? daemonAddress
    : DAEMON_CUSTOM_OPTION;
}

function getDaemonTestLabel(status: DaemonTestStatus): string {
  if (status === "testing") {
    return "Testing";
  }
  if (status === "ok") {
    return "All ok";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Test";
}

export function WalletsList() {
  const daemonAddress = options.getValue("daemonAddress");
  window.globalHttpConfig.mapUrl = (url) => daemonAddress + url;

  const buildListView = React.useCallback(() => {
    return { type: "list" as const, walletNames: listWalletNames() };
  }, []);
  const cpuThreads = options.getValue("cpuThreads");

  const [view, setView] = React.useState<
    | {
        type: "list";
        walletNames: string[];
      }
    | {
        type: "restore";
      }
    | {
        type: "opening";
        fileName: string;
        isStartupAutoOpen: boolean;
      }
    | {
        type: "opened";
        openedWallet: OpenedWallet;
      }
    | {
        type: "manage-wallets";
      }
    | {
        type: "options";
      }
    | {
        type: "create-new-wallet";
      }
  >(buildListView);
  const backToList = React.useCallback(
    () => setView(buildListView()),
    [buildListView],
  );
  const handleRestoreDone = React.useCallback(
    (openedWallet: OpenedWallet | null) => {
      if (openedWallet) {
        void (async () => {
          try {
            const walletFile = await openedWallet.wallet.get_wallet_file();
            options.setValue("lastWalletName", walletFile);
          } catch (e) {
            console.error("Failed to read opened wallet file name:", e);
          }
        })();
        setView({ type: "opened", openedWallet });
      } else {
        backToList();
      }
    },
    [backToList],
  );
  const handleCreateDone = React.useCallback(
    (openedWallet: OpenedWallet | null) => {
      if (openedWallet) {
        void (async () => {
          try {
            const walletFile = await openedWallet.wallet.get_wallet_file();
            options.setValue("lastWalletName", walletFile);
          } catch (e) {
            console.error("Failed to read opened wallet file name:", e);
          }
        })();
        setView({ type: "opened", openedWallet });
      } else {
        backToList();
      }
    },
    [backToList],
  );
  const handleOpenDone = React.useCallback(
    (openedWallet: OpenedWallet | null) => {
      if (openedWallet) {
        void (async () => {
          try {
            const walletFile = await openedWallet.wallet.get_wallet_file();
            options.setValue("lastWalletName", walletFile);
          } catch (e) {
            console.error("Failed to read opened wallet file name:", e);
          }
        })();
        setView({ type: "opened", openedWallet });
      } else {
        options.setValue("lastWalletName", null);
        backToList();
      }
    },
    [backToList],
  );

  React.useEffect(() => {
    setMaxConcurrency(cpuThreads);
  }, [cpuThreads]);

  React.useEffect(() => {
    if (!options.getValue("loadLastWallet")) {
      return;
    }
    const lastWalletName = options.getValue("lastWalletName");
    if (!lastWalletName) {
      return;
    }
    const walletNames = listWalletNames();
    if (!walletNames.includes(lastWalletName)) {
      console.warn(
        `Option "loadLastWallet" is set but last wallet "${lastWalletName}" not found in wallet list`,
      );
      options.setValue("lastWalletName", null);
      return;
    }

    setView({
      type: "opening",
      fileName: lastWalletName,
      isStartupAutoOpen: true,
    });
  }, [buildListView]);

  if (view.type === "opened") {
    return (
      <WalletMain
        wallet={view.openedWallet.wallet}
        onExit={() => {
          const { wallet, releaseWalletOpenLock } = view.openedWallet;
          backToList();
          options.setValue("lastWalletName", null);
          void closeWallet(wallet).finally(releaseWalletOpenLock);
        }}
      />
    );
  } else if (view.type === "restore") {
    return <RestoreView onDone={handleRestoreDone} />;
  } else if (view.type === "create-new-wallet") {
    return <CreateNewWalletView onDone={handleCreateDone} />;
  } else if (view.type === "opening") {
    return (
      <OpenWalletView
        fileName={view.fileName}
        isStartupAutoOpen={view.isStartupAutoOpen}
        onDone={handleOpenDone}
      />
    );
  } else if (view.type === "list") {
    return (
      <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
        <Header>Amethyst XMR Wallet</Header>

        <SectionPanel className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          {view.walletNames.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-white/70">Existing wallets</p>
              <span className="rounded-md bg-white/8 px-2 py-1 text-xs font-semibold text-white/65 ring-1 ring-white/10">
                {view.walletNames.length}
              </span>
            </div>
          )}

          <div className="lg:min-h-0 lg:flex-1">
            {view.walletNames.length === 0 ? (
              <SurfaceCard className="space-y-3 text-sm text-white/70">
                <div className="text-base font-semibold text-white/90">
                  Welcome to Amethyst XMR
                </div>
                <p>
                  This is a self-custodial Monero wallet that runs in your
                  browser using a WebAssembly build of libwallet.
                </p>
                <div className="text-white/65">
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Self-custodial</li>
                    <li>Send and receive XMR</li>
                    <li>Multisig support</li>
                    <li>
                      Import and export wallets compatible with
                      monero-wallet-cli
                    </li>
                  </ul>
                </div>
                <p className="text-white/65">
                  To begin, create a new wallet or restore an existing one
                  below.
                </p>
              </SurfaceCard>
            ) : (
              <div className="scrollbar-glass h-auto overflow-visible lg:h-full lg:overflow-auto lg:pr-1">
                <div className="space-y-2">
                  {view.walletNames.map((name) => (
                    <ListRowButton
                      key={name}
                      className="my-0"
                      onClick={() => {
                        setView({
                          type: "opening",
                          fileName: name,
                          isStartupAutoOpen: false,
                        });
                      }}
                    >
                      <span>{name}</span>
                    </ListRowButton>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 lg:shrink-0">
            <Button
              onClick={async () => {
                setView({ type: "create-new-wallet" });
              }}
            >
              ➕︎ New wallet
            </Button>
            <Button onClick={() => setView({ type: "restore" })}>
              ↺ Restore
            </Button>
            <Button
              onClick={() => {
                setView({ type: "manage-wallets" });
              }}
            >
              ☰ Manage wallets
            </Button>
            <Button
              onClick={() => {
                setView({ type: "options" });
              }}
            >
              ⚙ Options
            </Button>
          </div>
        </SectionPanel>
      </div>
    );
  } else if (view.type === "manage-wallets") {
    return <ManageWalletsView onBack={backToList} />;
  } else if (view.type === "options") {
    return <OptionsView onBack={backToList} />;
  } else {
    view satisfies never;
    return null;
  }
}

async function closeWallet(wallet: MoneroWasmWallet): Promise<void> {
  try {
    await wallet.close_wallet();
  } catch (e) {
    console.error("Error closing wallet:", e);
  }
  try {
    await wallet.delete();
  } catch (e) {
    console.error("Error deleting wallet:", e);
  }
}

async function testDaemonConnection(daemonAddress: string): Promise<void> {
  const tempWalletName = `${TEMP_DAEMON_TEST_WALLET_PREFIX}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const previousMapUrl = window.globalHttpConfig.mapUrl;
  window.globalHttpConfig.mapUrl = (url) => daemonAddress + url;

  try {
    await withFsLock(async () => {
      const tempWallet = createWallet();
      try {
        await tempWallet.init();
        const secret32 = crypto.getRandomValues(new Uint8Array(32));
        await tempWallet.generate(tempWalletName, "", secret32, false, false);
        await tempWallet.get_daemon_blockchain_height();
      } finally {
        await closeWallet(tempWallet);
        deleteWalletFiles(tempWalletName);
      }
    });
  } finally {
    window.globalHttpConfig.mapUrl = previousMapUrl;
  }
}

async function getBlockchainHeightByDateUsingTempWallet(
  year: number,
  month: number,
  day: number,
): Promise<bigint> {
  const tempWallet = createWallet();
  try {
    await tempWallet.init();
    return await tempWallet.get_blockchain_height_by_date(year, month, day);
  } finally {
    await closeWallet(tempWallet);
  }
}

function DoublePasswordInput({
  password,
  passwordConfirm,
  disabled,
  onPasswordChange,
  onPasswordConfirmChange,
}: {
  password: string;
  passwordConfirm: string;
  disabled: boolean;
  onPasswordChange: (value: string) => void;
  onPasswordConfirmChange: (value: string) => void;
}) {
  return (
    <FormRow>
      <div className="sm:hidden">
        <Label>Password (optional), confirm password</Label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="hidden sm:block">
            <Label>Password (optional)</Label>
          </div>
          <Input
            type="password"
            autoComplete="off"
            placeholder="Password (optional)"
            value={password}
            disabled={disabled}
            onChange={(e) => onPasswordChange(e.target.value)}
          />
        </div>
        <div>
          <div className="hidden sm:block">
            <Label>{"\u00A0"}</Label>
          </div>
          <Input
            type="password"
            autoComplete="off"
            placeholder="Confirm password"
            value={passwordConfirm}
            disabled={disabled}
            onChange={(e) => onPasswordConfirmChange(e.target.value)}
          />
        </div>
      </div>
      {passwordConfirm && password !== passwordConfirm && (
        <div className="mt-1 text-[11px] text-red-300">
          Password confirmation does not match.
        </div>
      )}
    </FormRow>
  );
}

function RestoreView({
  onDone,
}: {
  onDone: (openedWallet: OpenedWallet | null) => void;
}) {
  const alert = useAlert();
  // TODO: Remove this hardcoded values
  const [fileName, setFileName] = React.useState("kek");
  const [moneroSeed, setMoneroSeed] = React.useState(
    `verification italics saved under upper fetches answers masterful general ` +
      `sickness ounce narrate joining cuddled faxed pledge touchy zippers turnip ` +
      `nephew renting dedicated fibula gecko verification`,
  );
  const [cakeSeed, setCakeSeed] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");

  const [startingHeight, setStartingHeight] = React.useState("3603563");
  const [loadingHeight, setLoadingHeight] = React.useState(false);
  const [seedType, setSeedType] = React.useState<"monero-25" | "cake-16">(
    "monero-25",
  );

  const [restoring, setRestoring] = React.useState(false);

  const doRestore = (seedType: "monero-25" | "cake-16") => {
    if (!fileName) {
      void alert("Please enter wallet name");
      return;
    }
    if (listWalletNames().includes(fileName)) {
      void alert(`Wallet with name ${fileName} already exists`);
      return;
    }
    if (password !== passwordConfirm) {
      void alert("Password confirmation does not match");
      return;
    }

    if (seedType === "monero-25") {
      if (loadingHeight) {
        void alert("Please wait until starting height is loaded");
        return;
      }
      if (!moneroSeed) {
        void alert("Please enter seed");
        return;
      }
    } else {
      if (!cakeSeed) {
        void alert("Please enter seed");
        return;
      }
    }

    setRestoring(true);
    let wallet: MoneroWasmWallet | undefined;
    let releaseWalletOpenLock: (() => void) | null = null;
    (async () => {
      releaseWalletOpenLock = await acquireWalletOpenLock(fileName);
      if (!releaseWalletOpenLock) {
        throw new Error(
          `Wallet "${fileName}" is currently open in another tab`,
        );
      }

      let restoreHeight: bigint;
      let polyseedPrivateKey: Uint8Array | null = null;

      if (seedType === "monero-25") {
        try {
          restoreHeight = BigInt(startingHeight);
        } catch {
          throw new Error("Invalid starting height");
        }
      } else {
        const decoded = decodePolyseed(cakeSeed);
        if (!decoded.privateKey || decoded.privateKey.length !== 32) {
          throw new Error("Invalid Cake seed: decoded private key is invalid");
        }
        polyseedPrivateKey = decoded.privateKey;

        const birthdaySeconds = Number(decoded.birthday);
        if (!Number.isFinite(birthdaySeconds)) {
          throw new Error("Invalid Cake seed: birthday is invalid");
        }
        const birthdayDate = new Date(birthdaySeconds * 1000);
        if (isNaN(birthdayDate.getTime())) {
          throw new Error("Invalid Cake seed: birthday date is invalid");
        }
        const year = birthdayDate.getUTCFullYear();
        const month = birthdayDate.getUTCMonth() + 1;
        const day = birthdayDate.getUTCDate();
        restoreHeight = await getBlockchainHeightByDateUsingTempWallet(
          year,
          month,
          day,
        );
        setStartingHeight(restoreHeight.toString());
      }

      wallet = createWallet();
      await wallet.init();
      const secret32 =
        seedType === "monero-25"
          ? wallet.words_to_bytes(moneroSeed, "English")
          : polyseedPrivateKey;
      if (!secret32 || secret32.length !== 32) {
        throw new Error("Invalid seed phrase provided");
      }
      await withFsLock(async () => {
        if (!wallet) {
          throw new Error("Wallet was unexpectedly undefined");
        }
        await wallet.generate(fileName, password, secret32, true, false);
        await wallet.set_explicit_refresh_from_block_height(true);
        await wallet.set_refresh_from_block_height(restoreHeight);
        await wallet.rewrite(fileName, password);
        await wallet.store();
      });
      await persistNavigatorStorage();
      if (!releaseWalletOpenLock) {
        throw new Error("Wallet lock release callback is missing");
      }
      const openedWallet: OpenedWallet = {
        wallet,
        releaseWalletOpenLock,
      };
      releaseWalletOpenLock = null;
      console.info("Wallet restored and saved");
      setRestoring(false);
      onDone(openedWallet);
    })().catch((e) => {
      console.error("Error restoring wallet:", e);
      void alert(
        `Error restoring wallet: ${(e as Error).message || "Unknown error"}`,
      );
      if (wallet) {
        void closeWallet(wallet);
      }
      releaseWalletOpenLock?.();
      setRestoring(false);
    });
  };

  const onDateChange = (value: string) => {
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return;
    }
    const { year, month, day } = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
    setLoadingHeight(true);
    getBlockchainHeightByDateUsingTempWallet(year, month, day)
      .then((height) => {
        setStartingHeight(height.toString());
      })
      .catch((e) => {
        console.error("Error getting blockchain height by date:", e);
        setStartingHeight("error");
      })
      .then(() => {
        setLoadingHeight(false);
      });
  };

  return (
    <div className="space-y-4">
      <Header>Restore wallet</Header>
      <SectionPanel className="space-y-4">
        <FormRow>
          <Label>Wallet name</Label>
          <Input
            value={fileName}
            disabled={restoring}
            onChange={(e) => setFileName(e.target.value)}
          />
        </FormRow>

        <NiceTabs
          initialKey="monero-25"
          onTabChange={(key) => {
            if (key === "monero-25" || key === "cake-16") {
              setSeedType(key);
            }
          }}
          tabs={[
            {
              key: "monero-25",
              label: "Monero 25 words",
              content: (
                <div className="space-y-4">
                  <FormRow>
                    <Label>Seed phrase</Label>
                    <TextArea
                      rows={4}
                      value={moneroSeed}
                      disabled={restoring}
                      onChange={(e) => setMoneroSeed(e.target.value)}
                    ></TextArea>
                  </FormRow>

                  <FormRow className="!mb-0">
                    <Label>Starting height</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={!loadingHeight ? startingHeight : "Loading..."}
                        onChange={(e) => setStartingHeight(e.target.value)}
                        readOnly={loadingHeight || restoring}
                        disabled={loadingHeight || restoring}
                      />
                      <Input
                        type="date"
                        disabled={restoring}
                        onChange={(e) => onDateChange(e.target.value)}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-white/50">
                      Or pick a date to auto-fill block height.
                    </div>
                  </FormRow>
                </div>
              ),
            },
            {
              key: "cake-16",
              label: "Cake 16 words",
              content: (
                <div className="space-y-4">
                  <FormRow className="!mb-0">
                    <Label>Seed phrase</Label>
                    <TextArea
                      rows={4}
                      value={cakeSeed}
                      disabled={restoring}
                      onChange={(e) => setCakeSeed(e.target.value)}
                    ></TextArea>
                    <div className="mt-1 text-[11px] text-white/50">
                      Starting height is derived automatically from the seed
                    </div>
                  </FormRow>
                </div>
              ),
            },
          ]}
        />

        <DoublePasswordInput
          password={password}
          passwordConfirm={passwordConfirm}
          disabled={restoring}
          onPasswordChange={setPassword}
          onPasswordConfirmChange={setPasswordConfirm}
        />

        <ButtonsHolder>
          <Button
            className="w-full"
            variant="soft"
            onClick={() => onDone(null)}
            disabled={restoring}
          >
            ✖ Cancel
          </Button>
          <Button
            className="w-full"
            variant="primary"
            onClick={() => doRestore(seedType)}
            disabled={restoring}
          >
            {restoring ? "Restoring..." : "↺ Restore wallet"}
          </Button>
        </ButtonsHolder>
      </SectionPanel>
    </div>
  );
}

function CreateNewWalletView({
  onDone,
}: {
  onDone: (openedWallet: OpenedWallet | null) => void;
}) {
  const alert = useAlert();

  type CreateFormState = {
    fileName: string;
    password: string;
    passwordConfirm: string;
  };

  type CreateState =
    | ({ type: "entering-data" } & CreateFormState)
    | ({ type: "creating-wallet" } & CreateFormState)
    | {
        type: "showing-seed";
        wallet: MoneroWasmWallet;
        releaseWalletOpenLock: () => void;
        seed: string;
        daemonHeight: bigint | null;
        daemonHeightFetchedAt: number | null;
      };

  const [state, setState] = React.useState<CreateState>({
    type: "entering-data",
    fileName: "",
    password: "",
    passwordConfirm: "",
  });

  const doCreate = () => {
    if (state.type !== "entering-data") {
      return;
    }
    const { fileName, password, passwordConfirm } = state;

    if (!fileName) {
      void alert("Please enter wallet name");
      return;
    }
    if (listWalletNames().includes(fileName)) {
      void alert(`Wallet with name ${fileName} already exists`);
      return;
    }
    if (password !== passwordConfirm) {
      void alert("Password confirmation does not match");
      return;
    }

    setState({ type: "creating-wallet", fileName, password, passwordConfirm });

    let wallet: MoneroWasmWallet | undefined;
    let releaseWalletOpenLock: (() => void) | null = null;
    (async () => {
      releaseWalletOpenLock = await acquireWalletOpenLock(fileName);
      if (!releaseWalletOpenLock) {
        throw new Error(
          `Wallet "${fileName}" is currently open in another tab`,
        );
      }

      const seed = await withFsLock(async () => {
        wallet = createWallet();
        await wallet.init();

        const generatedSecret32 = await wallet.generate(
          fileName,
          password,
          new Uint8Array(32).fill(0),
          false,
          false,
        );

        if (!generatedSecret32 || generatedSecret32.length !== 32) {
          throw new Error("Generated secret is invalid");
        }
        if (generatedSecret32.every((byte) => byte === 0)) {
          throw new Error("Generated secret is all zeroes, which is invalid");
        }

        const seedLocal = await wallet.get_seed("English", "");

        await wallet.store();

        return seedLocal;
      });
      if (!wallet) {
        throw new Error("Wallet was unexpectedly undefined after creation");
      }
      await persistNavigatorStorage();
      if (!releaseWalletOpenLock) {
        throw new Error("Wallet lock release callback is missing");
      }
      const acquiredReleaseWalletOpenLock = releaseWalletOpenLock;
      releaseWalletOpenLock = null;
      console.info("Wallet created and saved");
      setState({
        type: "showing-seed",
        wallet,
        releaseWalletOpenLock: acquiredReleaseWalletOpenLock,
        seed,
        daemonHeight: null,
        daemonHeightFetchedAt: null,
      });
    })().catch((e) => {
      console.error("Error creating wallet:", e);
      void alert(
        `Error creating wallet: ${(e as Error).message || "Unknown error"}`,
      );
      if (wallet) {
        void closeWallet(wallet);
      }
      releaseWalletOpenLock?.();
      setState({ type: "entering-data", fileName, password, passwordConfirm });
    });
  };

  const doBackToListFromSeedStep = () => {
    if (state.type !== "showing-seed") {
      throw new Error(
        "Unexpected state: doBackToListFromSeedStep called outside showing-seed state",
      );
    }
    onDone(null);
    void closeWallet(state.wallet).finally(state.releaseWalletOpenLock);
  };

  React.useEffect(() => {
    if (state.type !== "showing-seed" || state.daemonHeightFetchedAt !== null) {
      return;
    }
    let cancelled = false;
    const wallet = state.wallet;
    wallet
      .get_daemon_blockchain_height()
      .then((daemonHeight) => {
        if (cancelled) {
          return;
        }
        setState((prev) => {
          if (
            prev.type !== "showing-seed" ||
            prev.wallet !== wallet ||
            prev.daemonHeightFetchedAt !== null
          ) {
            return prev;
          }
          return {
            ...prev,
            daemonHeight,
            daemonHeightFetchedAt: Date.now(),
          };
        });
      })
      .catch((e) => {
        console.warn("Could not fetch daemon height for created wallet:", e);
      });

    return () => {
      cancelled = true;
    };
  }, [state]);

  const isBusy = state.type === "creating-wallet";
  return (
    <div className="space-y-4">
      <Header>Create new wallet</Header>
      <SectionPanel className="space-y-4">
        {state.type === "creating-wallet" ? (
          <>
            <div className="text-xs tracking-[0.14em] uppercase text-white/45">
              Creating Wallet
            </div>
            <ProgressBar state="loading" text="Generating wallet..." />
          </>
        ) : state.type === "showing-seed" ? (
          <>
            <SurfaceCard className="space-y-3 bg-white/6 p-3">
              <div className="text-xs font-semibold text-amber-200">
                Save this seed phrase now. It is required to restore your
                wallet.
              </div>
              <div className="text-[11px] text-white/60">
                You can also view the seed later in the wallet.
              </div>
              <TextArea
                readOnly
                rows={4}
                className="font-mono text-sm leading-relaxed"
                value={state.seed}
              />
            </SurfaceCard>

            <SurfaceCard className="space-y-2 bg-white/6 p-3">
              <div className="text-[11px] text-white/50">
                Suggested restore scan start block (based on current daemon
                height)
              </div>
              <div className="font-mono text-sm text-white/90">
                {state.daemonHeight !== null
                  ? state.daemonHeight.toString()
                  : "Unavailable"}
                {state.daemonHeightFetchedAt !== null && (
                  <span className="font-sans text-xs text-white/60">
                    , {new Date(state.daemonHeightFetchedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </SurfaceCard>

            <ButtonsHolder>
              <Button
                className="w-full"
                variant="soft"
                onClick={doBackToListFromSeedStep}
              >
                ✖ Cancel
              </Button>
              <Button
                className="w-full"
                variant="primary"
                onClick={() =>
                  onDone({
                    wallet: state.wallet,
                    releaseWalletOpenLock: state.releaseWalletOpenLock,
                  })
                }
              >
                → Open wallet
              </Button>
            </ButtonsHolder>
          </>
        ) : (
          <>
            <FormRow>
              <Label>Wallet name</Label>
              <Input
                value={state.fileName}
                disabled={isBusy}
                onChange={(e) =>
                  setState({ ...state, fileName: e.target.value })
                }
              />
            </FormRow>

            <DoublePasswordInput
              password={state.password}
              passwordConfirm={state.passwordConfirm}
              disabled={isBusy}
              onPasswordChange={(value) =>
                setState({ ...state, password: value })
              }
              onPasswordConfirmChange={(value) =>
                setState({ ...state, passwordConfirm: value })
              }
            />

            <ButtonsHolder>
              <Button
                className="w-full"
                variant="soft"
                onClick={() => onDone(null)}
                disabled={isBusy}
              >
                ✖ Cancel
              </Button>
              <Button
                className="w-full"
                variant="primary"
                onClick={doCreate}
                disabled={isBusy}
              >
                ➕︎ Create wallet
              </Button>
            </ButtonsHolder>
          </>
        )}
      </SectionPanel>
    </div>
  );
}

function OpenWalletView({
  onDone,
  fileName,
  isStartupAutoOpen,
}: {
  fileName: string;
  isStartupAutoOpen: boolean;
  onDone: (openedWallet: OpenedWallet | null) => void;
}) {
  type OpenPhase =
    | "acquiring-lock"
    | "opening-initial"
    | "idle"
    | "opening-user";

  const alert = useAlert();
  const [password, setPassword] = React.useState("");
  const [phase, setPhase] = React.useState<OpenPhase>("acquiring-lock");
  const walletOpenLockReleaseRef = React.useRef<(() => void) | null>(null);

  const doOpen = React.useCallback(
    (isInitial: boolean, passwordToTry: string) => {
      setPhase(isInitial ? "opening-initial" : "opening-user");
      let wallet: MoneroWasmWallet | undefined;
      (async () => {
        const releaseWalletOpenLock = walletOpenLockReleaseRef.current;
        if (!releaseWalletOpenLock) {
          throw new Error("Wallet open lock is not acquired");
        }

        await persistNavigatorStorage();
        wallet = createWallet();
        await wallet.init();
        await wallet.load(fileName, passwordToTry);
        if (!releaseWalletOpenLock) {
          throw new Error("Wallet lock release callback is missing");
        }
        const openedWallet: OpenedWallet = {
          wallet,
          releaseWalletOpenLock,
        };
        walletOpenLockReleaseRef.current = null;
        onDone(openedWallet);
      })().catch((e) => {
        if (wallet) {
          void closeWallet(wallet);
        }

        if (!isInitial) {
          console.error("Error opening wallet:", e);
          void alert(
            `Error opening wallet: ${(e as Error).message || "Unknown error"}`,
          );
        }

        setPhase("idle");
      });
    },
    [alert, fileName, onDone],
  );

  React.useEffect(() => {
    let cancelled = false;
    setPassword("");
    setPhase("acquiring-lock");
    (async () => {
      const releaseWalletOpenLock = await acquireWalletOpenLock(fileName, {
        ifAvailable: true,
      });

      if (cancelled) {
        releaseWalletOpenLock?.();
        return;
      }

      if (!releaseWalletOpenLock) {
        if (!isStartupAutoOpen) {
          await alert(`Wallet "${fileName}" is already opened in another tab.`);
        }
        onDone(null);
        setPhase("idle");
        return;
      }

      walletOpenLockReleaseRef.current = releaseWalletOpenLock;
      doOpen(true, "");
    })();

    return () => {
      cancelled = true;
      const releaseWalletOpenLock = walletOpenLockReleaseRef.current;
      walletOpenLockReleaseRef.current = null;
      releaseWalletOpenLock?.();
    };
  }, [alert, doOpen, fileName, isStartupAutoOpen, onDone]);

  const isBusy = phase !== "idle";

  return (
    <div className="space-y-4">
      <Header>{fileName}</Header>

      <SectionPanel className="space-y-3">
        <div className="text-xs tracking-[0.14em] uppercase text-white/45">
          Opening Wallet
        </div>

        {phase === "acquiring-lock" || phase === "opening-initial" ? (
          <div className="space-y-2">
            <div className="text-sm text-white/80">
              Preparing wallet data...
            </div>
            <ProgressBar state="loading" text="Loading wallet..." />
          </div>
        ) : (
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isBusy) {
                doOpen(false, password);
              }
            }}
          >
            {phase === "opening-user" && (
              <div className="mb-3">
                <ProgressBar
                  state="loading"
                  size="sm"
                  text="Opening wallet..."
                />
              </div>
            )}

            <FormRow>
              <Label>Wallet password</Label>
              <Input
                type="password"
                autoComplete="off"
                value={password}
                disabled={isBusy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormRow>

            <ButtonsHolder>
              <Button
                type="button"
                className="w-full"
                variant="soft"
                onClick={() => {
                  const releaseWalletOpenLock =
                    walletOpenLockReleaseRef.current;
                  walletOpenLockReleaseRef.current = null;
                  releaseWalletOpenLock?.();
                  onDone(null);
                }}
                disabled={isBusy}
              >
                ← Back
              </Button>
              <Button
                type="submit"
                className="w-full"
                variant="primary"
                disabled={isBusy}
              >
                {isBusy ? "Opening..." : "Open wallet"}
              </Button>
            </ButtonsHolder>
          </form>
        )}
      </SectionPanel>
    </div>
  );
}

function OptionsView({ onBack }: { onBack: () => void }) {
  const alert = useAlert();
  const loadLastWallet = options.getValue("loadLastWallet");
  const cpuThreads = options.getValue("cpuThreads");
  const [cpuThreadsInput, setCpuThreadsInput] = React.useState(() =>
    String(cpuThreads),
  );
  const recommendedCpuThreads = getRecommendedMaxConcurrency();
  const detectedCpuThreads =
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : null;
  const daemonAddress = options.getValue("daemonAddress");
  const [daemonSelectValue, setDaemonSelectValue] = React.useState(() =>
    getDaemonSelectValue(daemonAddress),
  );
  const [daemonTestStatus, setDaemonTestStatus] =
    React.useState<DaemonTestStatus>("idle");
  const buildInfoText = React.useMemo(() => {
    if (import.meta.env.DEV) {
      return "Development mode via Vite dev server.";
    }
    const ts = import.meta.env.VITE_BUILD_TIMESTAMP || "unknown time";
    const hash = import.meta.env.VITE_GIT_HASH || "unknown";
    return `Built ${ts}, git ${hash}.`;
  }, []);

  const refresh = React.useState(0)[1];
  React.useEffect(() => {
    setCpuThreadsInput(String(cpuThreads));
  }, [cpuThreads]);
  React.useEffect(() => {
    setDaemonSelectValue(getDaemonSelectValue(daemonAddress));
  }, [daemonAddress]);
  React.useEffect(() => {
    setDaemonTestStatus("idle");
  }, [daemonAddress]);

  const isCustomDaemonAddress = daemonSelectValue === DAEMON_CUSTOM_OPTION;

  return (
    <div className="space-y-4">
      <Header>Options</Header>

      <SectionPanel className="space-y-4">
        <Toggle
          checked={loadLastWallet}
          onChange={(next) => {
            options.setValue("loadLastWallet", next);
            refresh((x) => x + 1);
          }}
          label="Load last wallet on startup"
          description="Automatically open the previous wallet after app start."
        />

        <FormRow>
          <Label>CPU threads</Label>
          <InputWithAction
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={cpuThreadsInput}
            actionLabel="Set recommended"
            onAction={async () => {
              const next = recommendedCpuThreads;
              options.setValue("cpuThreads", next);
              setMaxConcurrency(next);
              setCpuThreadsInput(String(next));
              refresh((x) => x + 1);
              await alert(`CPU threads set to recommended value: ${next}`);
            }}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!/^\d*$/.test(raw)) {
                return;
              }
              setCpuThreadsInput(raw);
              if (raw === "") {
                return;
              }
              const parsed = Number(raw);
              if (!Number.isFinite(parsed) || parsed < 1) {
                return;
              }
              const clamped = Math.min(
                getMaxConcurrency(),
                Math.max(1, Math.trunc(parsed)),
              );
              options.setValue("cpuThreads", clamped);
              setMaxConcurrency(clamped);
              refresh((x) => x + 1);
            }}
            onBlur={() => {
              if (cpuThreadsInput === "") {
                setCpuThreadsInput(String(options.getValue("cpuThreads")));
              }
            }}
          />
          <div className="mt-1 text-[11px] text-white/50">
            {detectedCpuThreads !== null
              ? `Detected CPU cores: ${detectedCpuThreads}. Recommended: ${recommendedCpuThreads}.`
              : `Recommended: ${recommendedCpuThreads}.`}
          </div>
        </FormRow>

        <FormRow>
          <Label>Daemon address</Label>
          <Select.Root
            value={daemonSelectValue}
            onValueChange={(next) => {
              setDaemonSelectValue(next);
              if (next !== DAEMON_CUSTOM_OPTION) {
                options.setValue("daemonAddress", next);
                refresh((x) => x + 1);
              }
            }}
          >
            <Select.Trigger>
              <Select.Value>
                {daemonSelectValue === DAEMON_CUSTOM_OPTION
                  ? "Enter custom URL"
                  : daemonSelectValue}
              </Select.Value>
            </Select.Trigger>
            <Select.Content>
              {DAEMON_PRESET_OPTIONS.map((address) => (
                <Select.Option key={address} value={address}>
                  {address}
                </Select.Option>
              ))}
              <Select.Option value={DAEMON_CUSTOM_OPTION}>
                Enter custom URL
              </Select.Option>
            </Select.Content>
          </Select.Root>
          {isCustomDaemonAddress && (
            <Input
              className="mt-2 font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://your-node.example.com:18081"
              value={daemonAddress}
              onChange={(e) => {
                options.setValue("daemonAddress", e.target.value);
                refresh((x) => x + 1);
              }}
            />
          )}
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              className={`!flex-none !px-5 !py-2 text-xs ${
                daemonTestStatus === "ok"
                  ? "text-green-300 hover:text-green-200"
                  : daemonTestStatus === "failed"
                    ? "text-red-300 hover:text-red-200"
                    : ""
              }`}
              disabled={daemonTestStatus === "testing"}
              onClick={async () => {
                const target = options.getValue("daemonAddress").trim();
                setDaemonTestStatus("testing");
                if (!target) {
                  setDaemonTestStatus("failed");
                  return;
                }
                try {
                  await testDaemonConnection(target);
                  setDaemonTestStatus("ok");
                } catch (e) {
                  console.error("Daemon test failed:", e);
                  setDaemonTestStatus("failed");
                }
              }}
            >
              {getDaemonTestLabel(daemonTestStatus)}
            </Button>
          </div>
        </FormRow>
      </SectionPanel>

      <div className="mt-1">
        <div className="mb-2 text-center text-[10px] text-white/45">
          {buildInfoText}
        </div>
        <ButtonsHolder>
          <Button className="w-full" variant="soft" onClick={onBack}>
            ← Back
          </Button>
        </ButtonsHolder>
      </div>
    </div>
  );
}

function ManageWalletsView({ onBack }: { onBack: () => void }) {
  const alert = useAlert();
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const [walletNames, setWalletNames] = React.useState<string[]>(() =>
    listWalletNames(),
  );
  const [removeState, setRemoveState] = React.useState<
    | { type: "idle" }
    | {
        type: "confirm" | "removing";
        walletName: string;
      }
  >({ type: "idle" });
  const [renameState, setRenameState] = React.useState<
    | { type: "idle" }
    | {
        type: "editing" | "renaming";
        oldWalletName: string;
        newWalletName: string;
      }
  >({ type: "idle" });

  const doRemoveWallet = React.useCallback(async () => {
    if (removeState.type !== "confirm") {
      return;
    }
    let releaseWalletOpenLock: (() => void) | null = null;
    try {
      setRemoveState({ type: "removing", walletName: removeState.walletName });
      releaseWalletOpenLock = await acquireWalletOpenLock(
        removeState.walletName,
        { ifAvailable: true },
      );
      if (!releaseWalletOpenLock) {
        await alert(
          `Wallet "${removeState.walletName}" is already opened in another tab.`,
        );
        setRemoveState({ type: "idle" });
        return;
      }
      await withFsLock(async () => {
        deleteWalletFiles(removeState.walletName);
      });
      if (options.getValue("lastWalletName") === removeState.walletName) {
        options.setValue("lastWalletName", null);
      }
      setWalletNames(listWalletNames());
      setRemoveState({ type: "idle" });
    } catch (e) {
      console.error("Failed to remove wallet:", e);
      await alert(
        `Failed to remove wallet: ${(e as Error).message || "Unknown error"}`,
      );
      setRemoveState({ type: "idle" });
    } finally {
      releaseWalletOpenLock?.();
    }
  }, [alert, removeState]);

  const doExportWallet = React.useCallback(
    async (walletName: string) => {
      try {
        await withFsLock(async () => {
          const files = getWalletFilesData(walletName);
          const zip = new JSZip();
          for (const file of files) {
            zip.file(file.name, file.data);
          }
          const blob = await zip.generateAsync({ type: "blob" });
          downloadBlob(blob, `${walletName}.zip`);
        });
      } catch (e) {
        console.error("Failed to export wallet:", e);
        await alert(
          `Failed to export wallet: ${(e as Error).message || "Unknown error"}`,
        );
      }
    },
    [alert],
  );

  const doImportFromZip = React.useCallback(
    async (file: File) => {
      try {
        const importSummary = await withFsLock(async () => {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const imported: string[] = [];
          const skippedExisting: string[] = [];

          const filesByBaseName = new Map<
            string,
            {
              isDirectory: boolean;
              async: (type: "uint8array") => Promise<Uint8Array>;
            }
          >();

          for (const zipEntry of Object.values(zip.files)) {
            const baseName = zipEntry.name.split("/").pop() || "";
            if (!baseName) {
              continue;
            }
            filesByBaseName.set(baseName, {
              isDirectory: zipEntry.dir,
              async: (type) => zipEntry.async(type),
            });
          }

          for (const [
            keyFileName,
            keysEntry,
          ] of filesByBaseName.entries()) {
            if (keysEntry.isDirectory || !keyFileName.endsWith(".keys")) {
              continue;
            }
            const walletName = keyFileName.slice(0, -5);
            if (!walletName) {
              continue;
            }
            if (isWalletFileExists(walletName)) {
              skippedExisting.push(walletName);
              continue;
            }

            const keysFileData = await keysEntry.async("uint8array");

            const walletEntry = filesByBaseName.get(walletName);
            const walletFileData =
              walletEntry && !walletEntry.isDirectory
                ? await walletEntry.async("uint8array")
                : null;

            const otherFiles: { name: string; data: Uint8Array }[] = [];
            if (walletFileData) {
              otherFiles.push({
                name: walletName,
                data: walletFileData,
              });
            }
            for (const [
              otherBaseName,
              otherEntry,
            ] of filesByBaseName.entries()) {
              if (
                otherEntry.isDirectory ||
                otherBaseName === keyFileName ||
                otherBaseName === walletName
              ) {
                continue;
              }
              if (!otherBaseName.startsWith(walletName + ".")) {
                continue;
              }
              const otherFileData = await otherEntry.async("uint8array");
              otherFiles.push({
                name: otherBaseName,
                data: otherFileData,
              });
            }

            try {
              saveWalletFilesData(walletName, keysFileData, otherFiles);
              imported.push(walletName);
            } catch (e) {
              console.error("Failed to save wallet files:", e);
              skippedExisting.push(walletName);
            }
          }

          return { imported, skippedExisting };
        });

        setWalletNames(listWalletNames());

        const formatWalletSection = (
          title: string,
          wallets: string[],
          emptyText: string,
        ) => {
          if (wallets.length === 0) {
            return `${title} (0):\n${emptyText}`;
          }
          return `${title} (${wallets.length}):\n${wallets
            .map((name) => `- ${name}`)
            .join("\n")}`;
        };
        const importedText = formatWalletSection(
          "Imported",
          importSummary.imported,
          "No wallets were imported.",
        );
        const skippedText = formatWalletSection(
          "Skipped (already exists)",
          importSummary.skippedExisting,
          "No wallets were skipped.",
        );
        await alert(`Import completed.\n\n${importedText}\n\n${skippedText}`);
      } catch (e) {
        console.error("Failed to import wallets:", e);
        await alert(
          `Failed to import wallets: ${(e as Error).message || "Unknown error"}`,
        );
      }
    },
    [alert],
  );

  const doRenameWallet = React.useCallback(async () => {
    if (renameState.type !== "editing") {
      return;
    }
    const oldName = renameState.oldWalletName;
    const newName = renameState.newWalletName.trim();
    if (!newName) {
      await alert("Wallet name cannot be empty.");
      return;
    }
    if (newName === oldName) {
      setRenameState({ type: "idle" });
      return;
    }
    let releaseWalletOpenLock: (() => void) | null = null;
    try {
      setRenameState({
        type: "renaming",
        oldWalletName: oldName,
        newWalletName: renameState.newWalletName,
      });
      releaseWalletOpenLock = await acquireWalletOpenLock(oldName, {
        ifAvailable: true,
      });
      if (!releaseWalletOpenLock) {
        throw new Error(
          `Wallet "${oldName}" is currently opened in another tab.`,
        );
      }
      await withFsLock(async () => {
        renameWallet(oldName, newName);
      });
      if (options.getValue("lastWalletName") === oldName) {
        options.setValue("lastWalletName", newName);
      }
      setWalletNames(listWalletNames());
      setRenameState({ type: "idle" });
    } catch (e) {
      console.error("Failed to rename wallet:", e);
      await alert(
        `Failed to rename wallet: ${(e as Error).message || "Unknown error"}`,
      );
      setRenameState({ type: "idle" });
    } finally {
      releaseWalletOpenLock?.();
    }
  }, [alert, renameState]);

  return (
    <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
      <Header>Manage wallets</Header>

      <SectionPanel className="space-y-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {walletNames.length === 0 ? (
          <SurfaceCard className="text-sm text-white/60">
            No wallets available.
          </SurfaceCard>
        ) : (
          <div className="scrollbar-glass h-auto overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-auto lg:pr-1">
            <div className="space-y-3">
              {walletNames.map((walletName) => (
                <SurfaceCard
                  key={walletName}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="truncate text-sm text-white/85">{walletName}</div>
                  <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-nowrap sm:gap-2">
                    <Button
                      className="!flex-none whitespace-nowrap sm:shrink-0"
                      variant="soft"
                      onClick={() => {
                        setRemoveState({ type: "confirm", walletName });
                      }}
                    >
                      🗑 Remove
                    </Button>
                    <Button
                      className="!flex-none whitespace-nowrap sm:shrink-0"
                      variant="soft"
                      onClick={() => {
                        setRenameState({
                          type: "editing",
                          oldWalletName: walletName,
                          newWalletName: walletName,
                        });
                      }}
                    >
                      ✎ Rename
                    </Button>
                    <Button
                      className="!flex-none whitespace-nowrap sm:shrink-0"
                      variant="soft"
                      onClick={async () => {
                        await doExportWallet(walletName);
                      }}
                    >
                      ⬇︎ Export
                    </Button>
                  </div>
                </SurfaceCard>
              ))}
            </div>
          </div>
        )}
      </SectionPanel>

      <input
        ref={importInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) {
            return;
          }
          try {
            await doImportFromZip(file);
          } finally {
            e.target.value = "";
          }
        }}
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button className="w-full" variant="soft" onClick={onBack}>
          ← Back
        </Button>
        <Button
          className="w-full"
          onClick={() => {
            importInputRef.current?.click();
          }}
        >
          ⬆︎ Import
        </Button>
      </div>

      <ConfirmByTextDialog
        open={removeState.type !== "idle"}
        title="Remove wallet"
        description={
          removeState.type !== "idle" ? (
            <>
              Type{" "}
              <span className="font-mono text-white/90">
                {removeState.walletName}
              </span>{" "}
              to permanently remove wallet files.
            </>
          ) : (
            ""
          )
        }
        expectedText={removeState.type !== "idle" ? removeState.walletName : ""}
        confirmText="Remove wallet"
        cancelText="Cancel"
        busy={removeState.type === "removing"}
        onCancel={() => setRemoveState({ type: "idle" })}
        onConfirm={() => {
          void doRemoveWallet();
        }}
      />

      {renameState.type !== "idle" && (
        <OverlayDialog
          onClose={() => {
            if (renameState.type !== "renaming") {
              setRenameState({ type: "idle" });
            }
          }}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                renameState.type !== "renaming" &&
                renameState.newWalletName.trim() !== "" &&
                renameState.newWalletName.trim() !== renameState.oldWalletName
              ) {
                void doRenameWallet();
              }
            }}
          >
            <div className="text-base font-semibold text-white">
              Rename wallet
            </div>
            <div className="text-sm text-white/75">
              Enter new name for{" "}
              <span className="font-mono text-white/90">
                {renameState.oldWalletName}
              </span>
              .
            </div>
            <Input
              value={renameState.newWalletName}
              onChange={(e) => {
                setRenameState((prev) =>
                  prev.type === "idle"
                    ? prev
                    : { ...prev, newWalletName: e.target.value },
                );
              }}
              autoComplete="off"
              disabled={renameState.type === "renaming"}
            />
            <ButtonsHolder>
              <Button
                type="button"
                variant="soft"
                disabled={renameState.type === "renaming"}
                onClick={() => setRenameState({ type: "idle" })}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  renameState.type === "renaming" ||
                  renameState.newWalletName.trim() === "" ||
                  renameState.newWalletName.trim() === renameState.oldWalletName
                }
              >
                {renameState.type === "renaming"
                  ? "Renaming..."
                  : "Rename wallet"}
              </Button>
            </ButtonsHolder>
          </form>
        </OverlayDialog>
      )}
    </div>
  );
}

async function persistNavigatorStorage(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    !navigator.storage.persist
  ) {
    return false;
  }
  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      return true;
    }
    const persisted = await navigator.storage.persist();
    if (!persisted) {
      console.warn("Storage persistence was not granted");
      return false;
    }
    return true;
  } catch (e) {
    console.error("Error while trying to persist storage:", e);
    return false;
  }
}
