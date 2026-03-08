const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// Wallet list view is centered around a 640px content column height.
// Keep the desktop window just slightly larger to fit paddings/header/chrome.
const APP_WIDTH = 1160;
const APP_HEIGHT = 696;
const HOST = "127.0.0.1";
const PORT = 43110;

const DIST_DIR = path.resolve(__dirname, "..", "built-web");
const USER_DATA_DIR = path.join(os.homedir(), ".amethystxmr");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

app.setPath("userData", USER_DATA_DIR);

let staticServer = null;
let mainWindow = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

function securityHeaders() {
  return {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function resolveRequestPath(requestPathname) {
  let rawPath = decodeURIComponent(requestPathname || "/");
  if (rawPath === "/") {
    rawPath = "/index.html";
  }

  const normalized = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.resolve(DIST_DIR, `.${normalized.startsWith("/") ? normalized : `/${normalized}`}`);

  if (!candidate.startsWith(DIST_DIR)) {
    return null;
  }

  return candidate;
}

async function readServedFile(requestPathname) {
  const resolved = resolveRequestPath(requestPathname);
  if (!resolved) {
    return null;
  }

  try {
    const content = await fs.readFile(resolved);
    return {
      content,
      filePath: resolved,
    };
  } catch {
    if (path.extname(resolved)) {
      return null;
    }
  }

  const fallback = path.join(DIST_DIR, "index.html");
  try {
    const content = await fs.readFile(fallback);
    return {
      content,
      filePath: fallback,
    };
  } catch {
    return null;
  }
}

function createStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${HOST}`);
      const served = await readServedFile(url.pathname);

      if (!served) {
        res.writeHead(404, {
          ...securityHeaders(),
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        ...securityHeaders(),
        "Content-Type": getContentType(served.filePath),
      });
      res.end(served.content);
    });

    server.on("error", reject);
    server.listen(PORT, HOST, () => {
      resolve(server);
    });
  });
}

function createWindow(baseUrl) {
  const win = new BrowserWindow({
    useContentSize: true,
    width: APP_WIDTH,
    height: APP_HEIGHT,
    minWidth: APP_WIDTH,
    minHeight: APP_HEIGHT,
    maxWidth: APP_WIDTH,
    maxHeight: APP_HEIGHT,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#281549",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadURL(baseUrl);
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  mainWindow = win;
}

async function start() {
  await fs.access(path.join(DIST_DIR, "index.html"));
  staticServer = await createStaticServer();
  createWindow(`http://${HOST}:${PORT}/`);
}

app.whenReady().then(async () => {
  try {
    await start();
  } catch (error) {
    console.error("Failed to start native app:", error);
    app.quit();
  }
});

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (staticServer) {
    staticServer.close();
  }
});
