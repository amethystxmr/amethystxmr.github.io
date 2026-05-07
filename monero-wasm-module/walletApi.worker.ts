import * as Comlink from "comlink";
import * as walletApi from "./walletApi";

/*
TODO REMOVE COMMENTED CODE

async function initModule() {
  await walletApi.initModule();
}
*/

async function createWallet(networkType?: walletApi.NetworkType) {
  const wallet = await walletApi.createWallet(networkType);
  return Comlink.proxy(wallet);
}
export const exposedApi = {
  ...walletApi,
  // initModule,
  createWallet,
};

Comlink.expose(exposedApi);
