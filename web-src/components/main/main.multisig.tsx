import React from "react";
import {
  MoneroWasmWallet,
  PaymentDetailsTransformed,
} from "../../../monero-wasm-module/walletApi";
import { Button, TextArea } from "../ui";
import { formatWalletTimestamp } from "../utils";

export function MultisigTab({
  wallet,
  onRefresh,
  payments,
  mempoolPayments,
}: {
  wallet: MoneroWasmWallet;
  onRefresh: () => void;
  payments: PaymentDetailsTransformed[] | null;
  mempoolPayments: PaymentDetailsTransformed[] | null;
}) {
  return <div className="mt-2 space-y-3">TODO</div>;
}
