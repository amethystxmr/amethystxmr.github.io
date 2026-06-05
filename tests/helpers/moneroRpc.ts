import { MONEROD_RPC_URL } from "../constants";

type JsonRpcResponse<T> = {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: { code: number; message: string };
};

export async function callMoneroJsonRpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${MONEROD_RPC_URL}/json_rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "0",
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status} while calling ${method}`);
  }

  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(
      `RPC ${method} failed: [${body.error.code}] ${body.error.message}`,
    );
  }
  if (body.result === undefined) {
    throw new Error(`RPC ${method} returned an empty result`);
  }

  return body.result;
}

export async function getBlockchainHeight(): Promise<number> {
  const result = await callMoneroJsonRpc<{ height: number }>("get_info", {});
  return result.height;
}

export async function generateBlocks(
  walletAddress: string,
  amountOfBlocks: number,
): Promise<string[]> {
  const result = await callMoneroJsonRpc<{ blocks: string[] }>(
    "generateblocks",
    {
      wallet_address: walletAddress,
      amount_of_blocks: amountOfBlocks,
    },
  );
  return result.blocks;
}
