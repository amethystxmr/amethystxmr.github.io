import * as React from "react";
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
  FormRow,
  SectionPanel,
  SurfaceCard,
  TextArea,
  useAlert,
} from "../ui";
import {
  createWallet,
  deleteWalletFiles,
  getRecommendedMaxConcurrency,
  listWalletNames,
  MoneroWasmWallet,
  saveFilesystem,
  setMaxConcurrency,
} from "../../../monero-wasm-module/walletApi";
import { WalletMain } from "../main";
import { ProgressBar } from "../ui";
import { getDefaultOptions, options } from "../options";

export function WalletsList() {
  const daemonAddress = options.getValue("daemonAddress");
  window.globalHttpConfig.mapUrl = (url) => daemonAddress + url;

  const buildListView = React.useCallback(() => {
    return { type: "list" as const, walletNames: listWalletNames() };
  }, []);
  const alert = useAlert();
  const allowWalletRemoval = options.getValue("allowWalletRemoval");
  const cpuThreads = options.getValue("cpuThreads");
  const [removeState, setRemoveState] = React.useState<
    | { type: "idle" }
    | {
        type: "confirm" | "removing";
        walletName: string;
      }
  >({ type: "idle" });

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
      }
    | {
        type: "opened";
        wallet: MoneroWasmWallet;
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

    setView({ type: "opening", fileName: lastWalletName });
  }, [buildListView]);

  const doRemoveWallet = React.useCallback(async () => {
    if (removeState.type !== "confirm") {
      return;
    }
    try {
      setRemoveState({ type: "removing", walletName: removeState.walletName });
      deleteWalletFiles(removeState.walletName);
      await saveFilesystem();
      if (options.getValue("lastWalletName") === removeState.walletName) {
        options.setValue("lastWalletName", null);
      }
      setRemoveState({ type: "idle" });
      backToList();
    } catch (e) {
      console.error("Failed to remove wallet:", e);
      await alert(
        `Failed to remove wallet: ${(e as Error).message || "Unknown error"}`,
      );
      setRemoveState({ type: "idle" });
    }
  }, [alert, backToList, removeState]);

  if (view.type === "opened") {
    return (
      <WalletMain
        wallet={view.wallet}
        onExit={() => {
          const wallet = view.wallet;
          backToList();
          options.setValue("lastWalletName", null);
          wallet
            .close_wallet()
            .catch((e) => {
              console.error("Error closing wallet after failed restore:", e);
            })
            .then(() => {
              return wallet.delete();
            })
            .catch((e) => {
              console.error("Error deleting wallet after failed restore:", e);
            });
        }}
      />
    );
  } else if (view.type === "restore") {
    return (
      <RestoreView
        onDone={(wallet) => {
          if (wallet) {
            options.setValue("lastWalletName", wallet.get_wallet_file());
            setView({ type: "opened", wallet });
          } else {
            backToList();
          }
        }}
      />
    );
  } else if (view.type === "create-new-wallet") {
    return (
      <CreateNewWalletView
        onDone={(wallet) => {
          if (wallet) {
            options.setValue("lastWalletName", wallet.get_wallet_file());
            setView({ type: "opened", wallet });
          } else {
            backToList();
          }
        }}
      />
    );
  } else if (view.type === "opening") {
    return (
      <OpenWalletView
        fileName={view.fileName}
        onDone={(wallet) => {
          if (wallet) {
            options.setValue("lastWalletName", wallet.get_wallet_file());
            setView({ type: "opened", wallet });
          } else {
            options.setValue("lastWalletName", null);
            backToList();
          }
        }}
      />
    );
  } else if (view.type === "list") {
    return (
      <div className="space-y-4">
        <Header>Amethyst XMR Wallet</Header>

        <SectionPanel className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-white/70">Existing wallets</p>
            <span className="rounded-md bg-white/8 px-2 py-1 text-xs font-semibold text-white/65 ring-1 ring-white/10">
              {view.walletNames.length}
            </span>
          </div>

          {view.walletNames.length === 0 ? (
            <SurfaceCard className="text-sm text-white/60">
              No wallets yet. Create or restore one below.
            </SurfaceCard>
          ) : (
            <div className="space-y-2">
              {view.walletNames.map((name) => (
                <ListRowButton
                  key={name}
                  className="my-0"
                  onClick={() => {
                    setView({
                      type: "opening",
                      fileName: name,
                    });
                  }}
                >
                  <span>{name}</span>
                  {allowWalletRemoval && (
                    <span
                      role="button"
                      className="ml-auto cursor-pointer rounded-md px-2 py-1 text-gray-400 transition hover:bg-red-500/10 hover:text-red-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemoveState({ type: "confirm", walletName: name });
                      }}
                    >
                      🗑
                    </span>
                  )}
                </ListRowButton>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                setView({ type: "options" });
              }}
            >
              ⚙ Options
            </Button>
          </div>
        </SectionPanel>
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
          expectedText={
            removeState.type !== "idle" ? removeState.walletName : ""
          }
          confirmText="Remove wallet"
          cancelText="Cancel"
          busy={removeState.type === "removing"}
          onCancel={() => setRemoveState({ type: "idle" })}
          onConfirm={() => {
            void doRemoveWallet();
          }}
        />
      </div>
    );
  } else if (view.type === "options") {
    return <OptionsView onBack={backToList} />;
  } else {
    view satisfies never;
    return null;
  }
}

function RestoreView({
  onDone,
}: {
  onDone: (wallet: MoneroWasmWallet | null) => void;
}) {
  const alert = useAlert();
  const [fileName, setFileName] = React.useState("kek");
  // 467y3cWwEMRikyE3LedE1xhdB41d31ZHn3EQrsvxrvvmYu3zcT32JtRguFeAvmhmquRpVEWHYExTd4d5x9RDPQRzGVxDT1z
  // 8BWN39sXMo8WpyXVhSuUucSG8o17Q8nRVNw3VnWBSqXY6GV33zu1MEYSn1WgkdVxRc9yAZQT84gtdCytg1NRFcjPHcFXmpC
  const [seed, setSeed] = React.useState(
    `verification italics saved under upper fetches answers masterful general ` +
      `sickness ounce narrate joining cuddled faxed pledge touchy zippers turnip ` +
      `nephew renting dedicated fibula gecko verification`,
  );
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");

  const [startingHeight, setStartingHeight] = React.useState("3603563");
  const [loadingHeight, setLoadingHeight] = React.useState(false);

  const [restoring, setRestoring] = React.useState(false);

  const doRestore = () => {
    if (loadingHeight) {
      void alert("Please wait until starting height is loaded");
      return;
    }
    if (!fileName) {
      void alert("Please enter wallet name");
      return;
    }
    if (listWalletNames().includes(fileName)) {
      void alert(`Wallet with name ${fileName} already exists`);
      return;
    }
    if (!seed) {
      void alert("Please enter seed");
      return;
    }
    if (password !== passwordConfirm) {
      void alert("Password confirmation does not match");
      return;
    }
    let startHeightBigInt;
    try {
      startHeightBigInt = BigInt(startingHeight);
    } catch {
      void alert("Invalid starting height");
      return;
    }

    setRestoring(true);
    let wallet: MoneroWasmWallet;
    (async () => {
      wallet = createWallet();
      await wallet.init();
      const secret32 = wallet.words_to_bytes(seed, "English");
      // console.info("Restoring wallet with secret bytes:", secret32, [...secret32!]);
      if (!secret32 || secret32.length !== 32) {
        throw new Error("Invalid seed phrase provided");
      }
      await wallet.generate(fileName, password, secret32, true, false);
      wallet.set_refresh_from_block_height(startHeightBigInt);
      await wallet.store();
      await saveFilesystem();
      console.info("Wallet restored and saved");
      setRestoring(false);
      onDone(wallet);
    })().catch((e) => {
      console.error("Error restoring wallet:", e);
      void alert(
        `Error restoring wallet: ${(e as Error).message || "Unknown error"}`,
      );
      wallet
        .close_wallet()
        .catch((e) => {
          console.error("Error closing wallet after failed restore:", e);
        })
        .then(() => {
          return wallet.delete();
        })
        .catch((e) => {
          console.error("Error deleting wallet after failed restore:", e);
        });
      setRestoring(false);
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
            onChange={(e) => setFileName(e.target.value)}
          />
        </FormRow>

        <FormRow>
          <Label>Seed phrase</Label>
          <TextArea
            rows={4}
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          ></TextArea>
        </FormRow>

        <FormRow>
          <Label>Starting height</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={!loadingHeight ? startingHeight : "Loading..."}
              onChange={(e) => setStartingHeight(e.target.value)}
              readOnly={loadingHeight}
              disabled={loadingHeight}
            />
            <Input
              type="date"
              onChange={(e) => {
                const d = new Date(e.target.value);
                if (isNaN(d.getTime())) {
                  return;
                }
                const { year, month, day } = {
                  year: d.getUTCFullYear(),
                  month: d.getUTCMonth() + 1,
                  day: d.getUTCDate(),
                };
                setLoadingHeight(true);
                const tempWallet = createWallet();
                tempWallet
                  .init()
                  .then(() =>
                    tempWallet.get_blockchain_height_by_date(year, month, day),
                  )
                  .then((height) => {
                    setStartingHeight(height.toString());
                  })
                  .catch((e) => {
                    console.error(
                      "Error getting blockchain height by date:",
                      e,
                    );
                    setStartingHeight("error");
                  })
                  .then(() => {
                    setLoadingHeight(false);
                    return tempWallet.close_wallet();
                  })
                  .catch((e) => {
                    console.error("Error closing temporary wallet:", e);
                  })
                  .then(() => {
                    return tempWallet.delete();
                  })
                  .catch((e) => {
                    console.error("Error deleting temporary wallet:", e);
                  });
              }}
            />
          </div>
          <div className="mt-1 text-[11px] text-white/50">
            Or pick a date to auto-fill block height.
          </div>
        </FormRow>

        <FormRow>
          <Label>Password (optional)</Label>
          <Input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormRow>

        <FormRow>
          <Label>Confirm password</Label>
          <Input
            type="password"
            autoComplete="off"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
          />
          {passwordConfirm && password !== passwordConfirm && (
            <div className="mt-1 text-[11px] text-red-300">
              Password confirmation does not match.
            </div>
          )}
        </FormRow>

        <ButtonsHolder>
          <Button
            className="w-full"
            variant="primary"
            onClick={doRestore}
            disabled={restoring}
          >
            {restoring ? "Restoring..." : "↺ Restore wallet"}
          </Button>
          <Button
            className="w-full"
            variant="soft"
            onClick={() => onDone(null)}
            disabled={restoring}
          >
            ✖ Cancel
          </Button>
        </ButtonsHolder>
      </SectionPanel>
    </div>
  );
}

function CreateNewWalletView({
  onDone,
}: {
  onDone: (wallet: MoneroWasmWallet | null) => void;
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
    (async () => {
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

      const seed = await wallet.get_seed("English", "");

      await wallet.store();
      await saveFilesystem();
      console.info("Wallet created and saved");
      setState({
        type: "showing-seed",
        wallet,
        seed,
        daemonHeight: null,
        daemonHeightFetchedAt: null,
      });
    })().catch((e) => {
      console.error("Error creating wallet:", e);
      void alert(
        `Error creating wallet: ${(e as Error).message || "Unknown error"}`,
      );
      wallet
        ?.close_wallet()
        .catch((closeErr) => {
          console.error("Error closing wallet after failed create:", closeErr);
        })
        .then(() => {
          wallet?.delete();
        })
        .catch((deleteErr) => {
          console.error(
            "Error deleting wallet after failed create:",
            deleteErr,
          );
        });
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
    state.wallet
      .close_wallet()
      .catch((e) => {
        console.error("Error closing wallet after create flow cancel:", e);
      })
      .then(() => {
        state.wallet.delete();
      })
      .catch((e) => {
        console.error(
          "Error deleting wallet instance after create flow cancel:",
          e,
        );
      });
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
                onClick={() => onDone(state.wallet)}
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

            <FormRow>
              <Label>Password (optional)</Label>
              <Input
                type="password"
                autoComplete="off"
                value={state.password}
                disabled={isBusy}
                onChange={(e) =>
                  setState({ ...state, password: e.target.value })
                }
              />
            </FormRow>

            <FormRow>
              <Label>Confirm password</Label>
              <Input
                type="password"
                autoComplete="off"
                value={state.passwordConfirm}
                disabled={isBusy}
                onChange={(e) =>
                  setState({ ...state, passwordConfirm: e.target.value })
                }
              />
              {state.passwordConfirm &&
                state.password !== state.passwordConfirm && (
                  <div className="mt-1 text-[11px] text-red-300">
                    Password confirmation does not match.
                  </div>
                )}
            </FormRow>

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
}: {
  fileName: string;
  onDone: (wallet: MoneroWasmWallet | null) => void;
}) {
  const alert = useAlert();
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState<null | "initial" | "user">("initial");

  const doOpen = (isInitial: boolean) => {
    setBusy(isInitial ? "initial" : "user");
    let wallet: MoneroWasmWallet;
    (async () => {
      wallet = createWallet();
      await wallet.init();
      await wallet.load(fileName, password);
      onDone(wallet);
      setBusy(null);
    })().catch((e) => {
      wallet
        .close_wallet()
        .catch((e) => {
          console.error("Error closing wallet after failed restore:", e);
        })
        .then(() => {
          return wallet.delete();
        })
        .catch((e) => {
          console.error("Error deleting wallet after failed restore:", e);
        });

      if (!isInitial) {
        console.error("Error opening wallet:", e);
        void alert(
          `Error opening wallet: ${(e as Error).message || "Unknown error"}`,
        );
      }

      setBusy(null);
    });
  };

  React.useEffect(() => {
    doOpen(true);
  }, [fileName]);

  return (
    <div className="space-y-4">
      <Header>{fileName}</Header>

      <SectionPanel className="space-y-3">
        <div className="text-xs tracking-[0.14em] uppercase text-white/45">
          Opening Wallet
        </div>

        {busy === "initial" ? (
          <div className="space-y-2">
            <div className="text-sm text-white/80">
              Preparing wallet data...
            </div>
            <ProgressBar state="loading" text="Loading wallet..." />
          </div>
        ) : (
          <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            {busy === "user" && (
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
                disabled={!!busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormRow>

            <ButtonsHolder>
              <Button
                className="w-full"
                variant="soft"
                onClick={() => onDone(null)}
                disabled={!!busy}
              >
                ← Back
              </Button>
              <Button
                type="submit"
                className="w-full"
                variant="primary"
                onClick={() => doOpen(false)}
                disabled={!!busy}
              >
                {busy ? "Opening..." : "Open wallet"}
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
  const defaultOptions = React.useMemo(() => getDefaultOptions(), []);
  const loadLastWallet = options.getValue("loadLastWallet");
  const allowWalletRemoval = options.getValue("allowWalletRemoval");
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

  const refresh = React.useState(0)[1];
  React.useEffect(() => {
    setCpuThreadsInput(String(cpuThreads));
  }, [cpuThreads]);

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

        <Toggle
          checked={allowWalletRemoval}
          onChange={(next) => {
            options.setValue("allowWalletRemoval", next);
            refresh((x) => x + 1);
          }}
          label="Allow wallets removing"
          description="Show remove button in wallet list and allow deleting wallet files."
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
              const clamped = Math.max(1, Math.trunc(parsed));
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
          <InputWithAction
            value={daemonAddress}
            actionLabel="Reset"
            onAction={() => {
              options.setValue("daemonAddress", defaultOptions.daemonAddress);
              refresh((x) => x + 1);
            }}
            onChange={(e) => {
              options.setValue("daemonAddress", e.target.value);
              refresh((x) => x + 1);
            }}
          />
        </FormRow>
      </SectionPanel>

      <div className="mt-1">
        <ButtonsHolder>
          <Button className="w-full" variant="soft" onClick={onBack}>
            ← Back
          </Button>
        </ButtonsHolder>
      </div>
    </div>
  );
}
