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
  timeoutMs = 120_000,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${MONEROD_RPC_URL}/json_rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "0",
        method,
        params,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`RPC ${method} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

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

export async function generateBlocks(
  walletAddress: string,
  amountOfBlocks: number,
): Promise<string[]> {
  const result = await callMoneroJsonRpc<{ blocks: string[] }>("generateblocks", {
    wallet_address: walletAddress,
    amount_of_blocks: amountOfBlocks,
  });
  return result.blocks;
}
