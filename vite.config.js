import crossOriginIsolation from "vite-plugin-cross-origin-isolation";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

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
  plugins: [react(), tailwindcss(), crossOriginIsolation(), emitGitHashFile()],
  define: {
    "import.meta.env.VITE_BUILD_TIMESTAMP": JSON.stringify(buildTimestamp),
    "import.meta.env.VITE_GIT_HASH": JSON.stringify(gitHashShort),
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
  },
};
