import crossOriginIsolation from "vite-plugin-cross-origin-isolation";
import tailwindcss from "@tailwindcss/vite";

/** @type {import('vite').UserConfig} */
export default {
  // config options
  root: "web-src",
  build: {
    outDir: "../built-web",
    target: "esnext",
  },
  plugins: [tailwindcss(), crossOriginIsolation()],
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
