import crossOriginIsolation from "vite-plugin-cross-origin-isolation";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";

function getGitHash() {
  try {
    return execSync("git rev-parse --short=12 HEAD", {
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

/** @type {import('vite').UserConfig} */
export default {
  // config options
  root: "web-src",
  build: {
    outDir: "../built-web",
    target: "esnext",
  },
  plugins: [tailwindcss(), crossOriginIsolation()],
  define: {
    "import.meta.env.VITE_BUILD_TIMESTAMP": JSON.stringify(buildTimestamp),
    "import.meta.env.VITE_GIT_HASH": JSON.stringify(gitHash),
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
