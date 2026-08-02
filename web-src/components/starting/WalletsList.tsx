import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Button,
  ButtonsHolder,
  ConfirmByTextDialog,
  ConfirmDialog,
  Toggle,
  Header,
  Hint,
  Input,
  Label,
  ListRowButton,
  OverlayDialog,
  Select,
  FormRow,
  SectionPanel,
  SurfaceCard,
  TextArea,
  useAlert,
  useIsUnmountedRef,
} from "../ui";
import {
  NetworkTypes,
  type NetworkType as NetworkTypeValue,
  MoneroWasmWallet,
  api as walletApi,
} from "../../../monero-wasm-module/walletApi.workerClient";
import { WalletMain } from "../main";
import { ProgressBar } from "../ui";
import {
  checkDaemonAddress,
  createIdleRemoteDaemonNodesProgress,
  createInitialRemoteDaemonNodesProgress,
  type DaemonAddressCheckResult,
  getDaemonPresetOptions,
  loadRemoteDaemonNodes,
  networkTypeToDaemonNettype,
} from "../daemonNodes";
import { options } from "../options";
import { NiceTabs } from "../main/tabs";
import {
  acquireWalletOpenLock,
  copyToClipboard,
  downloadBlob,
  normalizeSeedPhrase,
  splitAddressBy6,
  withFsLock,
} from "../utils";
import {
  getWalletDisplayName,
  validateWalletName,
} from "../../../monero-wasm-module/walletName";
import {
  buildWalletsZip,
  buildWalletZip,
  formatImportSummary,
  importWalletArchiveEntries,
  readWalletArchive,
} from "./walletArchives";

type OpenedWallet = {
  wallet: MoneroWasmWallet;
  releaseWalletOpenLock: () => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const DAEMON_CUSTOM_OPTION = "__custom__";
const DAEMON_REMOTE_NODES_STATUS_OPTION = "__monero_fail_status__";
const PROJECT_GITHUB_URL =
  "https://github.com/amethystxmr/amethystxmr.github.io";
const PROJECT_GITHUB_ISSUES_URL = `${PROJECT_GITHUB_URL}/issues`;
const DONATION_ADDRESS =
  "8C8sVurTyRh9Y2XSon7nbXYg4XTVqzcNoJiTgqxvkbseRRUNpH64Ptu396tTaxKuoPNY6jwUhCfjURpUwrNqe8dn5YUghK2";
const NETWORK_TYPE_OPTIONS = [
  { value: NetworkTypes.MAINNET, label: "Mainnet" },
  { value: NetworkTypes.TESTNET, label: "Testnet" },
  { value: NetworkTypes.STAGENET, label: "Stagenet" },
  { value: NetworkTypes.FAKECHAIN, label: "Fakenet" },
] as const;

type DaemonTestStatus = "idle" | "testing" | "ok" | "failed" | "wrong_network";
type DaemonAddressCheckState =
  { status: "checking" } | DaemonAddressCheckResult;

function ProjectSupportDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = React.useState<"idle" | "ok" | "fail">("idle");

  async function onCopyDonationAddress() {
    setCopied("idle");
    const ok = await copyToClipboard(DONATION_ADDRESS);
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied("idle"), 1200);
  }
  const formattedAddress = splitAddressBy6(DONATION_ADDRESS);

  return (
    <OverlayDialog onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-white">
              Support AmethystXMR
            </div>
            <a
              href={PROJECT_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-xs text-white/55 transition hover:text-white/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {PROJECT_GITHUB_URL}
            </a>
          </div>

          <Button
            type="button"
            onClick={onClose}
            variant="soft"
            className="flex-none! rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            ✖ Close
          </Button>
        </div>

        <div className="space-y-1 text-xs text-white/70">
          <div className="text-white/45">donation address</div>
          <Input
            aria-label="Donation address"
            readOnly
            value={formattedAddress}
            onFocus={(e) => e.currentTarget.select()}
            className="overflow-x-auto rounded-lg border-white/10 bg-black/20 py-2 font-mono text-xs whitespace-nowrap text-white/85 focus-visible:ring-white/30"
          />
        </div>

        <Button
          type="button"
          onClick={onCopyDonationAddress}
          variant="primary"
          className="w-full flex-none! rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          {copied === "ok" ? (
            <>
              <span aria-hidden="true">✓</span> Copied
            </>
          ) : copied === "fail" ? (
            <>
              <span aria-hidden="true">✖</span> Copy failed
            </>
          ) : (
            <>
              <span aria-hidden="true">⎘</span> Copy donation address
            </>
          )}
        </Button>

        <div className="flex flex-col items-center gap-2 rounded-lg bg-black/20 p-3 ring-1 ring-white/10">
          <div className="rounded-md bg-white p-2">
            <QRCodeSVG value={DONATION_ADDRESS} size={240} />
          </div>
          <div className="text-[11px] text-white/55">
            Scan to copy donation address
          </div>
        </div>

        <div className="text-center text-sm text-white/70">
          Feel free to create issues in{" "}
          <a
            href={PROJECT_GITHUB_ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-white/90 underline decoration-white/35 underline-offset-4 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            github
          </a>
        </div>
      </div>
    </OverlayDialog>
  );
}

function getWalletNameFromHash(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const withoutHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!withoutHash) {
    return null;
  }
  const firstSegment = withoutHash
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)[0];
  if (!firstSegment) {
    return null;
  }
  try {
    return decodeURIComponent(firstSegment);
  } catch {
    return firstSegment;
  }
}

function setWalletHash(walletName: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  const hash =
    walletName === null ? "" : `#/${encodeURIComponent(walletName)}/`;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}

function parseSecretKeyHex(value: string, label: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be exactly 64 hex characters`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; ++i) {
    const offset = i * 2;
    bytes[i] = Number.parseInt(normalized.slice(offset, offset + 2), 16);
  }
  return bytes;
}

function getDaemonCatalogAddresses(
  presets: readonly string[],
  remoteAddresses: readonly string[],
): string[] {
  return [...presets, ...remoteAddresses];
}

function getDaemonSelectAddresses(
  daemonAddress: string,
  presets: readonly string[],
  remoteAddresses: readonly string[],
): string[] {
  const catalog = getDaemonCatalogAddresses(presets, remoteAddresses);
  const trimmed = daemonAddress.trim();
  if (trimmed && !catalog.includes(trimmed)) {
    return [trimmed, ...catalog];
  }
  return catalog;
}

function getDaemonSelectValue(
  daemonAddress: string,
  knownAddresses: readonly string[],
): string {
  return knownAddresses.includes(daemonAddress)
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
  if (status === "wrong_network") {
    return "Wrong network type";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Check connection";
}

function formatDaemonOptionLabel(
  address: string,
  checkState: DaemonAddressCheckState | undefined,
): string {
  if (!checkState) {
    return address;
  }
  if (checkState.status === "checking") {
    return `${address} (checking...)`;
  }
  if (checkState.status === "ok") {
    return `${address} (ok)`;
  }
  if (checkState.status === "wrong_network") {
    return `${address} (wrong nettype)`;
  }
  return `${address} (failed: ${checkState.reason})`;
}

function daemonTestStatusFromCheckResult(
  result: DaemonAddressCheckResult,
): DaemonTestStatus {
  if (result.status === "ok") {
    return "ok";
  }
  if (result.status === "wrong_network") {
    return "wrong_network";
  }
  return "failed";
}

function getNetworkTypeSelectValue(networkType: NetworkTypeValue): string {
  return String(networkType);
}

function parseNetworkTypeSelectValue(value: string): NetworkTypeValue {
  const parsed = Number(value);
  if (
    parsed === NetworkTypes.MAINNET ||
    parsed === NetworkTypes.TESTNET ||
    parsed === NetworkTypes.STAGENET ||
    parsed === NetworkTypes.FAKECHAIN
  ) {
    return parsed;
  }
  return NetworkTypes.MAINNET;
}

export function WalletsList() {
  const alert = useAlert();
  const [isSupportDialogOpen, setIsSupportDialogOpen] = React.useState(false);
  const [view, setView] = React.useState<
    | {
        type: "initial loading";
        doAutoOpen: boolean;
      }
    | {
        type: "list";
        walletNames: string[];
        doAutoOpen: boolean;
      }
    | {
        type: "restore";
        walletNames: string[];
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
        walletNames: string[];
      }
    | {
        type: "options";
      }
    | {
        type: "create-new-wallet";
        walletNames: string[];
      }
  >({
    type: "initial loading",
    doAutoOpen: true,
  });
  const backToList = React.useCallback(
    () =>
      setView({
        type: "initial loading",
        doAutoOpen: false,
      }),
    [],
  );
  React.useEffect(() => {
    if (view.type !== "initial loading") {
      return;
    }

    let cancelled = false;
    (async () => {
      const daemonAddress = options.getValue("daemonAddress");
      await walletApi.setDaemonAddress(daemonAddress);
      const walletNames = await withFsLock(async () =>
        walletApi.listWalletNames(),
      );
      if (cancelled) {
        return;
      }
      setView({
        type: "list",
        walletNames,
        doAutoOpen: view.doAutoOpen,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  const onReloadWalletNames = React.useCallback(async () => {
    if (view.type !== "manage-wallets") {
      throw new Error("Invalid view type");
    }
    const walletNames = await withFsLock(async () =>
      walletApi.listWalletNames(),
    );
    setView({
      type: "manage-wallets",
      walletNames,
    });
  }, [view]);

  const handleRestoreDone = React.useCallback(
    (openedWallet: OpenedWallet | null) => {
      if (openedWallet) {
        void (async () => {
          try {
            const walletFile = await openedWallet.wallet.get_wallet_file();
            const walletName = getWalletDisplayName(walletFile);
            options.setValue("lastWalletName", walletName);
            setWalletHash(walletName);
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
            const walletName = getWalletDisplayName(walletFile);
            options.setValue("lastWalletName", walletName);
            setWalletHash(walletName);
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
            const walletName = getWalletDisplayName(walletFile);
            options.setValue("lastWalletName", walletName);
            setWalletHash(walletName);
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
    if (view.type !== "list") {
      return;
    }
    if (!view.doAutoOpen) {
      return;
    }
    const walletNameFromHash = getWalletNameFromHash();
    if (walletNameFromHash) {
      if (!view.walletNames.includes(walletNameFromHash)) {
        console.warn(
          `Wallet "${walletNameFromHash}" from hash is not found in wallet list`,
        );
      } else {
        setView({
          type: "opening",
          fileName: walletNameFromHash,
          isStartupAutoOpen: true,
        });
        return;
      }
    }

    if (!options.getValue("loadLastWallet")) {
      return;
    }
    const lastWalletName = options.getValue("lastWalletName");
    if (!lastWalletName) {
      return;
    }
    if (!view.walletNames.includes(lastWalletName)) {
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
  }, [view]);

  if (view.type === "initial loading") {
    return (
      <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
        <Header>Amethyst XMR Wallet</Header>
        <SectionPanel>
          <div className="text-sm text-white/70">Loading wallets...</div>
        </SectionPanel>
      </div>
    );
  } else if (view.type === "opened") {
    return (
      <WalletMain
        wallet={view.openedWallet.wallet}
        onExit={() => {
          const { wallet, releaseWalletOpenLock } = view.openedWallet;
          backToList();
          options.setValue("lastWalletName", null);
          setWalletHash(null);
          /*
           * When true: tear down wallet on worker only (same-tab second open may break).
           * When false: reload workaround after exit.
           */
          const WALLET_TERMINATING_FIXED = false;
          if (WALLET_TERMINATING_FIXED) {
            void closeWallet(wallet).finally(releaseWalletOpenLock);
          } else {
            void alert("Loading");
            window.location.reload();
          }
        }}
      />
    );
  } else if (view.type === "restore") {
    return (
      <RestoreView onDone={handleRestoreDone} walletNames={view.walletNames} />
    );
  } else if (view.type === "create-new-wallet") {
    return (
      <CreateNewWalletView
        onDone={handleCreateDone}
        walletNames={view.walletNames}
      />
    );
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
                    <li>Self-custodial: your keys stay in your browser</li>
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
                setView({
                  type: "create-new-wallet",
                  walletNames: view.walletNames,
                });
              }}
            >
              ➕︎ New wallet
            </Button>
            <Button
              onClick={() =>
                setView({ type: "restore", walletNames: view.walletNames })
              }
            >
              ↺ Restore
            </Button>
            <Button
              onClick={() => {
                setView({
                  type: "manage-wallets",
                  walletNames: view.walletNames,
                });
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

          {view.walletNames.length > 0 && (
            <button
              type="button"
              className="mx-auto block cursor-pointer rounded-md px-2 py-1 text-sm font-semibold text-white/75 underline decoration-white/30 underline-offset-4 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              onClick={() => setIsSupportDialogOpen(true)}
            >
              Support AmethystXMR, make a donation →
            </button>
          )}
        </SectionPanel>

        {isSupportDialogOpen && (
          <ProjectSupportDialog onClose={() => setIsSupportDialogOpen(false)} />
        )}
      </div>
    );
  } else if (view.type === "manage-wallets") {
    return (
      <ManageWalletsView
        onBack={backToList}
        walletNames={view.walletNames}
        onReloadWalletNames={onReloadWalletNames}
      />
    );
  } else if (view.type === "options") {
    return <OptionsView onBack={backToList} />;
  } else {
    view satisfies never;
    return null;
  }
}

async function closeWallet(wallet: MoneroWasmWallet): Promise<void> {
  try {
    await wallet.delete();
  } catch (e) {
    console.error("Error deleting wallet:", e);
  }
}

async function createWalletUsingCurrentOptions(): Promise<MoneroWasmWallet> {
  const wallet = await walletApi.createWallet(options.getValue("networkType"));
  try {
    if (options.getValue("allowMismatchedDaemonVersion")) {
      await wallet.allow_mismatched_daemon_version(true);
    }
    return wallet;
  } catch (e) {
    wallet.delete();
    throw e;
  }
}

async function getBlockchainHeightByDateUsingTempWallet(
  year: number,
  month: number,
  day: number,
): Promise<bigint> {
  const tempWallet = await createWalletUsingCurrentOptions();
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
  walletNames,
}: {
  onDone: (openedWallet: OpenedWallet | null) => void;
  walletNames: string[];
}) {
  const isUnmountedRef = useIsUnmountedRef();
  const alert = useAlert();
  const [fileName, setFileName] = React.useState("");
  const [moneroSeed, setMoneroSeed] = React.useState(``);
  const [cakeSeed, setCakeSeed] = React.useState("");
  const [multisigSeedHex, setMultisigSeedHex] = React.useState("");
  const [restoreAddress, setRestoreAddress] = React.useState("");
  const [secretViewKey, setSecretViewKey] = React.useState("");
  const [secretSpendKey, setSecretSpendKey] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");

  const [startingHeight, setStartingHeight] = React.useState("");
  const [loadingHeight, setLoadingHeight] = React.useState(false);
  const [seedType, setSeedType] = React.useState<
    "monero-25" | "cake-16" | "multisig" | "from-keys"
  >("monero-25");

  const [restoring, setRestoring] = React.useState(false);
  const [confirmUseDaemonHeight, setConfirmUseDaemonHeight] =
    React.useState(false);

  const doRestore = (
    seedType: "monero-25" | "cake-16" | "multisig" | "from-keys",
  ) => {
    let walletName: string;
    try {
      walletName = validateWalletName(fileName);
    } catch (error) {
      void alert(getErrorMessage(error));
      return;
    }
    if (walletNames.includes(walletName)) {
      void alert(`Wallet with name ${walletName} already exists`);
      return;
    }
    if (password !== passwordConfirm) {
      void alert("Password confirmation does not match");
      return;
    }

    if (
      seedType === "monero-25" ||
      seedType === "multisig" ||
      seedType === "from-keys"
    ) {
      if (loadingHeight) {
        void alert("Please wait until starting height is loaded");
        return;
      }
      if (seedType === "monero-25" && !normalizeSeedPhrase(moneroSeed)) {
        void alert("Please enter seed");
        return;
      }
      if (seedType === "multisig" && !multisigSeedHex.trim()) {
        void alert("Please enter multisig seed hex");
        return;
      }
      if (seedType === "from-keys") {
        if (!restoreAddress.trim()) {
          void alert("Please enter address");
          return;
        }
        if (!secretViewKey.trim()) {
          void alert("Please enter secret view key");
          return;
        }
      }
    } else {
      if (!normalizeSeedPhrase(cakeSeed)) {
        void alert("Please enter seed");
        return;
      }
    }

    const needsManualHeight =
      seedType === "monero-25" ||
      seedType === "multisig" ||
      seedType === "from-keys";
    if (needsManualHeight && startingHeight.trim() === "") {
      setConfirmUseDaemonHeight(true);
      return;
    }

    runRestore(seedType);
  };

  const runRestore = (
    seedType: "monero-25" | "cake-16" | "multisig" | "from-keys",
  ) => {
    let walletName: string;
    try {
      walletName = validateWalletName(fileName);
    } catch (error) {
      void alert(getErrorMessage(error));
      return;
    }

    setRestoring(true);
    let wallet: MoneroWasmWallet | undefined;
    let releaseWalletOpenLock: (() => void) | null = null;
    (async () => {
      releaseWalletOpenLock = await acquireWalletOpenLock(walletName);
      if (!releaseWalletOpenLock) {
        throw new Error(
          `Wallet "${walletName}" is currently open in another tab`,
        );
      }

      let restoreHeight: bigint | null = null;
      let polyseedPrivateKey: Uint8Array | null = null;

      if (
        seedType === "monero-25" ||
        seedType === "multisig" ||
        seedType === "from-keys"
      ) {
        const trimmed = startingHeight.trim();
        if (trimmed !== "") {
          try {
            restoreHeight = BigInt(trimmed);
          } catch {
            throw new Error("Invalid starting height");
          }
        }
      } else {
        const normalizedCakeSeed = normalizeSeedPhrase(cakeSeed);
        const decoded = await walletApi.decodePolyseed(normalizedCakeSeed);
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
        if (isUnmountedRef.current) {
          releaseWalletOpenLock?.();
          releaseWalletOpenLock = null;
          return;
        }
        setStartingHeight(restoreHeight.toString());
      }

      wallet = await createWalletUsingCurrentOptions();
      await wallet.init();
      await withFsLock(async () => {
        if (!wallet) {
          throw new Error("Wallet was unexpectedly undefined");
        }
        await walletApi.assertWalletNameAvailable(walletName);
        if (seedType === "multisig") {
          const normalizedMultisigSeedHex = multisigSeedHex.replace(/\s+/g, "");
          await wallet.generate_multisig_restore(
            walletName,
            password,
            normalizedMultisigSeedHex,
            false,
          );
        } else if (seedType === "from-keys") {
          const normalizedAddress = restoreAddress.trim();
          const viewKey = parseSecretKeyHex(
            secretViewKey.trim(),
            "Secret view key",
          );
          const spendKeyRaw = secretSpendKey.trim();
          if (spendKeyRaw.length > 0) {
            const spendKey = parseSecretKeyHex(spendKeyRaw, "Secret spend key");
            await wallet.generate_from_keys(
              walletName,
              password,
              normalizedAddress,
              viewKey,
              spendKey,
              false,
            );
          } else {
            await wallet.generate_view_only_from_keys(
              walletName,
              password,
              normalizedAddress,
              viewKey,
              false,
            );
          }
        } else {
          const secret32 =
            seedType === "monero-25"
              ? await wallet.words_to_bytes(
                  normalizeSeedPhrase(moneroSeed),
                  "English",
                )
              : polyseedPrivateKey;
          if (!secret32 || secret32.length !== 32) {
            throw new Error("Invalid seed phrase provided");
          }
          await wallet.generate(walletName, password, secret32, true, false);
        }
        await wallet.set_explicit_refresh_from_block_height(true);
        await wallet.set_refresh_from_block_height(
          restoreHeight ?? (await wallet.get_daemon_blockchain_height()),
        );
        await wallet.rewrite(walletName, password);
        await wallet.store();
      });
      await persistNavigatorStorage();
      if (isUnmountedRef.current) {
        await closeWallet(wallet);
        releaseWalletOpenLock?.();
        return;
      }
      if (!releaseWalletOpenLock) {
        throw new Error("Wallet lock release callback is missing");
      }
      const openedWallet: OpenedWallet = {
        wallet,
        releaseWalletOpenLock,
      };
      releaseWalletOpenLock = null;
      console.info("Wallet restored and saved");
      if (isUnmountedRef.current) {
        await closeWallet(openedWallet.wallet).finally(
          openedWallet.releaseWalletOpenLock,
        );
        return;
      }
      setRestoring(false);
      onDone(openedWallet);
    })().catch((e) => {
      if (isUnmountedRef.current) {
        if (wallet) {
          void closeWallet(wallet);
        }
        releaseWalletOpenLock?.();
        return;
      }
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
        if (isUnmountedRef.current) {
          return;
        }
        setStartingHeight(height.toString());
      })
      .catch((e) => {
        if (isUnmountedRef.current) {
          return;
        }
        console.error("Error getting blockchain height by date:", e);
        setStartingHeight("error");
      })
      .then(() => {
        if (isUnmountedRef.current) {
          return;
        }
        setLoadingHeight(false);
      });
  };

  const startingHeightBlock = (
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
  );

  const restoreTabContentClass =
    "space-y-4 h-auto overflow-visible lg:flex lg:h-full lg:min-h-0 lg:flex-col";

  return (
    <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
      <Header>Restore wallet</Header>
      <ConfirmDialog
        open={confirmUseDaemonHeight}
        title="No starting height"
        message="No height is provided. Do you want to use current blockchain height?"
        confirmText="Yes"
        cancelText="No"
        onCancel={() => setConfirmUseDaemonHeight(false)}
        onConfirm={() => {
          setConfirmUseDaemonHeight(false);
          runRestore(seedType);
        }}
      />
      <SectionPanel className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <FormRow className="lg:shrink-0">
          <Label>Wallet name</Label>
          <Input
            value={fileName}
            disabled={restoring}
            onChange={(e) => setFileName(e.target.value)}
          />
        </FormRow>

        <div className="lg:min-h-0 lg:flex-1">
          <NiceTabs
            initialKey="monero-25"
            className="lg:flex lg:h-full lg:min-h-0 lg:flex-col"
            onTabChange={(key) => {
              if (
                key === "monero-25" ||
                key === "cake-16" ||
                key === "multisig" ||
                key === "from-keys"
              ) {
                setSeedType(key);
              }
            }}
            tabs={[
              {
                key: "monero-25",
                label: "Monero 25 words",
                content: (
                  <div className={restoreTabContentClass}>
                    <FormRow className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                      <Label>Seed phrase</Label>
                      <TextArea
                        rows={3}
                        className="scrollbar-glass scrollbar-hidden-mobile overflow-y-auto lg:min-h-0 lg:flex-1"
                        value={moneroSeed}
                        disabled={restoring}
                        onChange={(e) => setMoneroSeed(e.target.value)}
                      ></TextArea>
                    </FormRow>

                    <div className="lg:shrink-0">{startingHeightBlock}</div>
                  </div>
                ),
              },
              {
                key: "cake-16",
                label: "Cake 16 words",
                content: (
                  <div className={restoreTabContentClass}>
                    <FormRow className="!mb-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                      <Label>Seed phrase</Label>
                      <TextArea
                        rows={3}
                        className="scrollbar-glass scrollbar-hidden-mobile overflow-y-auto lg:min-h-0 lg:flex-1"
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
              {
                key: "multisig",
                label: "Multisig",
                content: (
                  <div className={restoreTabContentClass}>
                    <FormRow className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                      <Label>Multisig seed (hex)</Label>
                      <TextArea
                        rows={3}
                        className="scrollbar-glass scrollbar-hidden-mobile overflow-y-auto lg:min-h-0 lg:flex-1"
                        value={multisigSeedHex}
                        disabled={restoring}
                        onChange={(e) => setMultisigSeedHex(e.target.value)}
                      ></TextArea>
                    </FormRow>

                    <div className="lg:shrink-0">{startingHeightBlock}</div>
                  </div>
                ),
              },
              {
                key: "from-keys",
                label: "From keys",
                content: (
                  <div className="space-y-4 scrollbar-glass h-auto overflow-visible lg:h-full lg:min-h-0 lg:overflow-auto lg:pr-1">
                    <FormRow>
                      <Label>Address</Label>
                      <Input
                        value={restoreAddress}
                        disabled={restoring}
                        onChange={(e) => setRestoreAddress(e.target.value)}
                      />
                    </FormRow>
                    <FormRow>
                      <Label>Secret view key (hex)</Label>
                      <Input
                        value={secretViewKey}
                        disabled={restoring}
                        placeholder="64 hex chars"
                        onChange={(e) => setSecretViewKey(e.target.value)}
                      />
                      <div className="mt-1 text-[11px] text-white/50">
                        Enter 64 hex characters (32 bytes).
                      </div>
                    </FormRow>
                    <FormRow>
                      <Label>Secret spend key (hex, optional)</Label>
                      <Input
                        value={secretSpendKey}
                        disabled={restoring}
                        placeholder="64 hex chars"
                        onChange={(e) => setSecretSpendKey(e.target.value)}
                      />
                      <div className="mt-1 text-[11px] text-white/50">
                        Leave empty for view-only wallet. If provided, use 64
                        hex characters.
                      </div>
                    </FormRow>

                    {startingHeightBlock}
                  </div>
                ),
              },
            ]}
          />
        </div>

        <div className="lg:shrink-0">
          <DoublePasswordInput
            password={password}
            passwordConfirm={passwordConfirm}
            disabled={restoring}
            onPasswordChange={setPassword}
            onPasswordConfirmChange={setPasswordConfirm}
          />
        </div>

        <div className="lg:shrink-0">
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
        </div>
      </SectionPanel>
    </div>
  );
}

function CreateNewWalletView({
  onDone,
  walletNames,
}: {
  onDone: (openedWallet: OpenedWallet | null) => void;
  walletNames: string[];
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

    let walletName: string;
    try {
      walletName = validateWalletName(fileName);
    } catch (error) {
      void alert(getErrorMessage(error));
      return;
    }

    if (password !== passwordConfirm) {
      void alert("Password confirmation does not match");
      return;
    }

    setState({
      type: "creating-wallet",
      fileName: walletName,
      password,
      passwordConfirm,
    });

    let wallet: MoneroWasmWallet | undefined;
    let releaseWalletOpenLock: (() => void) | null = null;
    (async () => {
      releaseWalletOpenLock = await acquireWalletOpenLock(walletName, {
        ifAvailable: true,
      });
      if (!releaseWalletOpenLock) {
        throw new Error(
          `Wallet "${walletName}" is currently open in another tab`,
        );
      }

      if (walletNames.includes(walletName)) {
        const release = releaseWalletOpenLock;
        releaseWalletOpenLock = null;
        release();
        void alert(`Wallet with name ${walletName} already exists`);
        setState({
          type: "entering-data",
          fileName: walletName,
          password,
          passwordConfirm,
        });
        return;
      }

      const seed = await withFsLock(async () => {
        await walletApi.assertWalletNameAvailable(walletName);
        wallet = await createWalletUsingCurrentOptions();
        await wallet.init();

        const generatedSecret32 = await wallet.generate(
          walletName,
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
      void alert(`Error creating wallet: ${getErrorMessage(e)}`);
      if (wallet) {
        void closeWallet(wallet);
      }
      releaseWalletOpenLock?.();
      setState({
        type: "entering-data",
        fileName: walletName,
        password,
        passwordConfirm,
      });
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
    Promise.resolve(wallet.get_daemon_blockchain_height())
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
    <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
      <Header>Create new wallet</Header>
      <SectionPanel className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {state.type === "creating-wallet" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="text-xs tracking-[0.14em] uppercase text-white/45">
              Creating wallet
            </div>
            <div className="mt-auto">
              <ProgressBar state="loading" text="Generating wallet..." />
            </div>
          </div>
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
                className="scrollbar-glass scrollbar-hidden-mobile overflow-y-auto font-mono text-sm leading-relaxed"
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

            <div className="mt-auto">
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
            </div>
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

            <div className="mt-auto">
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
            </div>
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
    "acquiring-lock" | "opening-initial" | "idle" | "opening-user";

  const alert = useAlert();
  const [password, setPassword] = React.useState("");
  const [phase, setPhase] = React.useState<OpenPhase>("acquiring-lock");
  const walletOpenLockReleaseRef = React.useRef<(() => void) | null>(null);
  const isUnmountedRef = useIsUnmountedRef();

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
        if (isUnmountedRef.current) {
          return;
        }
        await withFsLock(async () => {
          wallet = await createWalletUsingCurrentOptions();
          await wallet.init();
          if (isUnmountedRef.current) {
            await closeWallet(wallet);
            wallet = undefined;
            return;
          }
          await wallet.load(fileName, passwordToTry);
          if (isUnmountedRef.current) {
            await closeWallet(wallet);
            wallet = undefined;
          }
        });
        if (isUnmountedRef.current || !wallet) {
          return;
        }
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
        if (isUnmountedRef.current) {
          return;
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
    [alert, fileName, isUnmountedRef, onDone],
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
        if (cancelled) {
          return;
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
  }, [alert, doOpen, fileName, isStartupAutoOpen, isUnmountedRef, onDone]);

  const isBusy = phase !== "idle";

  return (
    <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
      <Header>{fileName}</Header>

      <SectionPanel className="space-y-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="text-xs tracking-[0.14em] uppercase text-white/45">
          Opening wallet
        </div>

        {phase === "acquiring-lock" || phase === "opening-initial" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="text-sm text-white/80">
              Preparing wallet data...
            </div>
            <div className="mt-auto">
              <ProgressBar state="loading" text="Loading wallet..." />
            </div>
          </div>
        ) : (
          <form
            className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
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

            <div className="mt-auto">
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
                  {isBusy ? "→ Opening..." : "→ Open wallet"}
                </Button>
              </ButtonsHolder>
            </div>
          </form>
        )}
      </SectionPanel>
    </div>
  );
}

function OptionsView({ onBack }: { onBack: () => void }) {
  const loadLastWallet = options.getValue("loadLastWallet");
  const networkType = options.getValue("networkType");
  const [networkTypeSelectValue, setNetworkTypeSelectValue] = React.useState(
    () => getNetworkTypeSelectValue(networkType),
  );
  const daemonAddress = options.getValue("daemonAddress");
  const daemonPresets = getDaemonPresetOptions(networkType);
  const [daemonListRequested, setDaemonListRequested] = React.useState(false);
  const [remoteDaemonFetch, setRemoteDaemonFetch] = React.useState(
    createIdleRemoteDaemonNodesProgress,
  );
  const [daemonCheckStatuses, setDaemonCheckStatuses] = React.useState<
    Record<string, DaemonAddressCheckState>
  >({});
  const [isEditingCustomDaemon, setIsEditingCustomDaemon] =
    React.useState(false);
  const [daemonSelectValue, setDaemonSelectValue] = React.useState(() =>
    getDaemonSelectValue(
      daemonAddress,
      getDaemonSelectAddresses(daemonAddress, daemonPresets, []),
    ),
  );
  const [daemonTestStatus, setDaemonTestStatus] =
    React.useState<DaemonTestStatus>("idle");
  const daemonTestAbortRef = React.useRef<AbortController | null>(null);
  const daemonTestTargetRef = React.useRef<string | null>(null);
  const buildInfoText = React.useMemo(() => {
    const ts = import.meta.env.DEV
      ? new Date().toISOString()
      : import.meta.env.VITE_BUILD_TIMESTAMP || "";
    const hash = import.meta.env.DEV
      ? "000000000000"
      : import.meta.env.VITE_GIT_HASH || "unknown";
    const parsedTs = ts ? new Date(ts) : null;
    const prettyTs =
      parsedTs && Number.isFinite(parsedTs.getTime())
        ? new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(parsedTs)
        : ts || "unknown time";
    return `Built ${prettyTs}, git ${hash}`;
  }, []);

  const [moneroVersionText, setMoneroVersionText] = React.useState("");
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const version = await walletApi.getMoneroVersionFull();
      if (cancelled) {
        return;
      }
      setMoneroVersionText(`Monero ${version}`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetDaemonListState = React.useCallback(() => {
    setDaemonListRequested(false);
    setRemoteDaemonFetch(createIdleRemoteDaemonNodesProgress());
    setDaemonCheckStatuses({});
    daemonTestAbortRef.current?.abort();
    daemonTestAbortRef.current = null;
    daemonTestTargetRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!daemonListRequested) {
      return;
    }
    const fetchController = new AbortController();
    setRemoteDaemonFetch(createInitialRemoteDaemonNodesProgress(networkType));
    void loadRemoteDaemonNodes(
      networkType,
      setRemoteDaemonFetch,
      fetchController.signal,
    );
    return () => {
      fetchController.abort();
    };
  }, [daemonListRequested, networkType]);

  React.useEffect(
    () => () => {
      daemonTestAbortRef.current?.abort();
      daemonTestTargetRef.current = null;
    },
    [],
  );

  const refresh = React.useState(0)[1];
  React.useEffect(() => {
    if (isEditingCustomDaemon) {
      return;
    }
    setDaemonSelectValue(
      getDaemonSelectValue(
        daemonAddress,
        getDaemonSelectAddresses(
          daemonAddress,
          daemonPresets,
          remoteDaemonFetch.nodes,
        ),
      ),
    );
  }, [
    daemonAddress,
    daemonPresets,
    remoteDaemonFetch.nodes,
    isEditingCustomDaemon,
  ]);
  React.useEffect(() => {
    setNetworkTypeSelectValue(getNetworkTypeSelectValue(networkType));
  }, [networkType]);
  React.useEffect(() => {
    if (
      daemonTestAbortRef.current &&
      daemonTestTargetRef.current === daemonAddress.trim()
    ) {
      return;
    }
    daemonTestTargetRef.current = null;
    setDaemonTestStatus("idle");
  }, [daemonAddress, networkType]);

  const loadedRemoteDaemonOptions = remoteDaemonFetch.nodes;
  const daemonSelectAddresses = getDaemonSelectAddresses(
    daemonAddress,
    daemonPresets,
    loadedRemoteDaemonOptions,
  );
  const remoteDaemonStatusLabel = !daemonListRequested
    ? null
    : remoteDaemonFetch.pendingCount > 0
      ? `Fetching nodes list (${remoteDaemonFetch.pendingCount})`
      : remoteDaemonFetch.failedSources.length > 0
        ? `Failed to fetch from ${remoteDaemonFetch.failedSources.join(", ")}`
        : null;
  const checkDaemonSelection = React.useCallback(
    async (
      targetAddress: string,
      targetNetworkType: NetworkTypeValue = networkType,
    ) => {
      const target = targetAddress.trim();
      daemonTestAbortRef.current?.abort();
      daemonTestAbortRef.current = null;
      daemonTestTargetRef.current = target;

      if (!target) {
        daemonTestTargetRef.current = null;
        setDaemonTestStatus("failed");
        return;
      }

      const controller = new AbortController();
      daemonTestAbortRef.current = controller;
      setDaemonCheckStatuses((prev) => ({
        ...prev,
        [target]: { status: "checking" },
      }));
      setDaemonTestStatus("testing");

      const result = await checkDaemonAddress(
        target,
        networkTypeToDaemonNettype(targetNetworkType),
        controller.signal,
      );

      if (
        controller.signal.aborted ||
        daemonTestAbortRef.current !== controller
      ) {
        return;
      }

      daemonTestAbortRef.current = null;
      daemonTestTargetRef.current = null;
      setDaemonTestStatus(daemonTestStatusFromCheckResult(result));
      setDaemonCheckStatuses((prev) => ({ ...prev, [target]: result }));
    },
    [networkType],
  );
  const testDaemonAddress = () => {
    const target = options.getValue("daemonAddress");
    setDaemonTestStatus("testing");
    void checkDaemonSelection(target);
  };
  const daemonTestButton = (
    <Button
      type="button"
      className={`flex-none! rounded-md px-4 py-1 text-[11px] ${
        daemonTestStatus === "ok"
          ? "text-green-300 hover:text-green-200"
          : daemonTestStatus === "failed" ||
              daemonTestStatus === "wrong_network"
            ? "text-red-300 hover:text-red-200"
            : ""
      }`}
      disabled={daemonTestStatus === "testing"}
      onClick={testDaemonAddress}
    >
      {getDaemonTestLabel(daemonTestStatus)}
    </Button>
  );

  return (
    <div className="space-y-4 lg:flex lg:h-[640px] lg:flex-col">
      <Header>Options</Header>

      <SectionPanel className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="space-y-4 scrollbar-glass lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-auto lg:pr-1">
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
            <Label>Network type</Label>
            <Select.Root
              value={networkTypeSelectValue}
              onValueChange={(next) => {
                const parsed = parseNetworkTypeSelectValue(next);
                setNetworkTypeSelectValue(getNetworkTypeSelectValue(parsed));
                options.setValue("networkType", parsed);
                resetDaemonListState();
                void checkDaemonSelection(
                  options.getValue("daemonAddress"),
                  parsed,
                );
                refresh((x) => x + 1);
              }}
            >
              <Select.Trigger>
                <Select.Value>
                  {NETWORK_TYPE_OPTIONS.find(
                    (item) => String(item.value) === networkTypeSelectValue,
                  )?.label || "Mainnet"}
                </Select.Value>
              </Select.Trigger>
              <Select.Content>
                {NETWORK_TYPE_OPTIONS.map((item) => (
                  <Select.Option key={item.value} value={String(item.value)}>
                    {item.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select.Root>
          </FormRow>

          <FormRow>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-gray-300">
                  Daemon address
                </div>
                <Hint>
                  <div className="space-y-2">
                    <p>
                      In a regular browser the daemon must use HTTPS and send
                      CORS headers.
                    </p>
                    <p>
                      In Tor Browser you can also use{" "}
                      <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-white">
                        http://*.onion
                      </code>{" "}
                      daemon addresses.
                    </p>
                  </div>
                </Hint>
              </div>
              {daemonTestButton}
            </div>
            {isEditingCustomDaemon ? (
              <Input
                className="font-mono text-sm"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="https://your-node.example.com:18081"
                value={daemonAddress}
                onChange={(e) => {
                  options.setValue("daemonAddress", e.target.value);
                  refresh((x) => x + 1);
                }}
                onBlur={() => {
                  const trimmed = options.getValue("daemonAddress").trim();
                  if (trimmed !== options.getValue("daemonAddress")) {
                    options.setValue("daemonAddress", trimmed);
                    refresh((x) => x + 1);
                  }
                  setIsEditingCustomDaemon(false);
                  setDaemonSelectValue(
                    getDaemonSelectValue(
                      trimmed,
                      getDaemonSelectAddresses(
                        trimmed,
                        daemonPresets,
                        loadedRemoteDaemonOptions,
                      ),
                    ),
                  );
                  void checkDaemonSelection(trimmed);
                }}
              />
            ) : (
              <Select.Root
                value={daemonSelectValue}
                onOpenChange={(open) => {
                  if (open) {
                    setDaemonListRequested(true);
                  }
                }}
                onValueChange={(next) => {
                  if (next === DAEMON_REMOTE_NODES_STATUS_OPTION) {
                    return;
                  }
                  if (next === DAEMON_CUSTOM_OPTION) {
                    setIsEditingCustomDaemon(true);
                    return;
                  }
                  setDaemonSelectValue(next);
                  options.setValue("daemonAddress", next);
                  void checkDaemonSelection(next);
                  refresh((x) => x + 1);
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
                  {daemonSelectAddresses.map((address) => {
                    const checkState = daemonCheckStatuses[address];
                    const isFailedCheck =
                      checkState?.status === "fail" ||
                      checkState?.status === "wrong_network";
                    return (
                      <Select.Option key={address} value={address}>
                        <span
                          className={
                            isFailedCheck ? "text-white/50" : undefined
                          }
                        >
                          {formatDaemonOptionLabel(address, checkState)}
                        </span>
                      </Select.Option>
                    );
                  })}
                  <Select.Option value={DAEMON_CUSTOM_OPTION}>
                    Enter custom URL
                  </Select.Option>
                  {remoteDaemonStatusLabel && (
                    <Select.Option
                      value={DAEMON_REMOTE_NODES_STATUS_OPTION}
                      disabled
                    >
                      {remoteDaemonStatusLabel}
                    </Select.Option>
                  )}
                </Select.Content>
              </Select.Root>
            )}
          </FormRow>
        </div>

        <div className="mt-2 lg:shrink-0">
          <div className="mb-3 px-2 text-center text-[10px] text-white/45">
            <div className="space-y-1 sm:hidden">
              <div>{buildInfoText}</div>
              <div>{moneroVersionText}</div>
            </div>
            <div className="hidden sm:block">{`${buildInfoText}, ${moneroVersionText}`}</div>
          </div>
          <ButtonsHolder>
            <Button className="w-full" variant="soft" onClick={onBack}>
              ← Back
            </Button>
          </ButtonsHolder>
        </div>
      </SectionPanel>
    </div>
  );
}

function ManageWalletsView({
  onBack,
  onReloadWalletNames,
  walletNames,
}: {
  onBack: () => void;
  onReloadWalletNames: () => Promise<void>;
  walletNames: string[];
}) {
  const alert = useAlert();
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
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
        await walletApi.deleteWalletFiles(removeState.walletName);
      });
      if (options.getValue("lastWalletName") === removeState.walletName) {
        options.setValue("lastWalletName", null);
      }
      await onReloadWalletNames();
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
  }, [alert, removeState, onReloadWalletNames]);

  const doExportWallet = React.useCallback(
    async (walletName: string) => {
      try {
        const files = await withFsLock(async () => {
          return await walletApi.getWalletFilesData(walletName);
        });
        const blob = await buildWalletZip(files);
        downloadBlob(blob, `${walletName}.zip`);
      } catch (e) {
        console.error("Failed to export wallet:", e);
        await alert(`Failed to export wallet: ${getErrorMessage(e)}`);
      }
    },
    [alert],
  );

  const doExportAllWallets = React.useCallback(async () => {
    try {
      const files = await withFsLock(async () => {
        return await walletApi.getAllWalletFilesData();
      });
      const blob = await buildWalletsZip(files);
      downloadBlob(blob, "amethystxmr-wallets.zip");
    } catch (e) {
      console.error("Failed to export all wallets:", e);
      await alert(`Failed to export all wallets: ${getErrorMessage(e)}`);
    }
  }, [alert]);

  const doImportFromZip = React.useCallback(
    async (file: File) => {
      try {
        const archiveEntries = await readWalletArchive(file);
        const importSummary = await withFsLock(async () => {
          return await importWalletArchiveEntries(archiveEntries);
        });

        await onReloadWalletNames();
        await alert(formatImportSummary(importSummary));
      } catch (e) {
        console.error("Failed to import wallets:", e);
        await alert(`Failed to import wallets: ${getErrorMessage(e)}`);
      }
    },
    [alert, onReloadWalletNames],
  );

  const doRenameWallet = React.useCallback(async () => {
    if (renameState.type !== "editing") {
      return;
    }
    const oldName = renameState.oldWalletName;
    let newName: string;
    try {
      newName = validateWalletName(renameState.newWalletName);
    } catch (error) {
      await alert(getErrorMessage(error));
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
        await walletApi.renameWallet(oldName, newName);
      });
      if (options.getValue("lastWalletName") === oldName) {
        options.setValue("lastWalletName", newName);
      }
      await onReloadWalletNames();
      setRenameState({ type: "idle" });
    } catch (e) {
      console.error("Failed to rename wallet:", e);
      await alert(`Failed to rename wallet: ${getErrorMessage(e)}`);
      setRenameState({ type: "idle" });
    } finally {
      releaseWalletOpenLock?.();
    }
  }, [alert, renameState, onReloadWalletNames]);

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
                  <div className="truncate text-sm text-white/85">
                    {walletName}
                  </div>
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
        <Button
          className="w-full"
          onClick={() => {
            void doExportAllWallets();
          }}
        >
          ⬇︎ Export all
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
                ✖ Cancel
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
                  ? "✎ Renaming..."
                  : "✎ Rename wallet"}
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
