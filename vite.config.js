import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { URL } from "node:url";

function getGitHash() {
  try {
    return execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const buildTimestamp = new Date().toISOString();
const gitHash = getGitHash();
const gitHashShort = gitHash === "unknown" ? gitHash : gitHash.slice(0, 12);

function getWasmWalletSize(fileName) {
  const fileUrl = new URL(`./monero-wasm-module/${fileName}`, import.meta.url);
  return existsSync(fileUrl) ? statSync(fileUrl).size : 0;
}

const wasmWalletSizes = {
  asyncify: getWasmWalletSize("wasm_wallet_asyncify.wasm"),
  threads: getWasmWalletSize("wasm_wallet_threads.wasm"),
};

const crossOriginIsolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function emitGitHashFile() {
  return {
    name: "emit-githash-file",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "githash.txt",
        source: `${gitHash}\n`,
      });
    },
  };
}

/** @type {import('vite').UserConfig} */
export default {
  // config options
  root: "web-src",
  build: {
    outDir: "../built-web",
    target: "esnext",
  },
  plugins: [
    react(),
    tailwindcss(),
    emitGitHashFile(),
  ],
  define: {
    "import.meta.env.VITE_BUILD_TIMESTAMP": JSON.stringify(buildTimestamp),
    "import.meta.env.VITE_GIT_HASH": JSON.stringify(gitHashShort),
    __WASM_WALLET_SIZES__: JSON.stringify(wasmWalletSizes),
  },
  worker: {
    format: "es",
  },
  server: {
    /*
    proxy: {
      "/api-proxy": {
        target: "http://127.0.0.1:18081",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ""),
      },
    },
    */
    allowedHosts: true,
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    // Vite falls back to server.headers when preview.headers is omitted.
    headers:
      process.env.AMETHYST_E2E_PREVIEW_COI === "1"
        ? crossOriginIsolationHeaders
        : {},
  },
};
