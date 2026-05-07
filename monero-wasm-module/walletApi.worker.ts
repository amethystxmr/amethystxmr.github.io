import * as Comlink from "comlink";
import * as walletApi from "./walletApi";

async function initModule() {
  await walletApi.initModule();
}

async function createWallet(networkType?: walletApi.NetworkType) {
  const wallet = await walletApi.createWallet(networkType);
  return Comlink.proxy(wallet);
}

async function setHttpFetchCallback(
  callback: walletApi.HttpFetchCallback | null,
) {
  walletApi.setHttpFetchCallback(callback);
}

export const exposedApi = {
  initModule,
  createWallet,
  setDaemonAddress: walletApi.setDaemonAddress,
  setHttpFetchCallback,
  setMaxConcurrency: walletApi.setMaxConcurrency,
  decodePolyseed: walletApi.decodePolyseed,
  getMoneroVersionFull: walletApi.getMoneroVersionFull,
  loadFilesystem: walletApi.loadFilesystem,
  saveFilesystem: walletApi.saveFilesystem,
  clearFilesystem: walletApi.clearFilesystem,
  setWalletNewBlockCallback: walletApi.setWalletNewBlockCallback,
  listWalletNames: walletApi.listWalletNames,
  deleteWalletFiles: walletApi.deleteWalletFiles,
  readFile: walletApi.readFile,
  writeFile: walletApi.writeFile,
  unlinkFile: walletApi.unlinkFile,
  isWalletFileExists: walletApi.isWalletFileExists,
  renameWallet: walletApi.renameWallet,
  getWalletFilesData: walletApi.getWalletFilesData,
  saveWalletFilesData: walletApi.saveWalletFilesData,
};

Comlink.expose(exposedApi);
