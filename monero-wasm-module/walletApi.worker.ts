import * as Comlink from "comlink";
import * as walletApi from "./walletApi";

/** Like `T`, but every method property returns a Promise of the original return. */
export type SequentialMethods<T extends object> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};

/**
 * Returns a proxy that runs each accessed method strictly after the previous
 * call settles (success or failure), so only one runs at a time.
 */
function ensureSequential<T extends object>(
  target: T,
): SequentialMethods<T> {
  let queue: Promise<unknown> = Promise.resolve();

  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const run = queue.then(() =>
          Promise.resolve(value.apply(obj, args as never[])),
        );
        queue = run.catch(() => {});
        return run;
      };
    },
  }) as SequentialMethods<T>;
}

/*
TODO REMOVE COMMENTED CODE

async function initModule() {
  await walletApi.initModule();
}
*/

async function createWallet(networkType?: walletApi.NetworkType) {
  const wallet = await walletApi.createWallet(networkType);
  return Comlink.proxy(ensureSequential(wallet));
}
export const exposedApi = {
  ...walletApi,
  // initModule,
  createWallet,
};

Comlink.expose(exposedApi);
