const { app, BrowserWindow, shell, protocol } = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

// Wallet list view is centered around a 640px content column height.
// Keep the desktop window just slightly larger to fit paddings/header/chrome.
const APP_WIDTH = 1200;
const APP_HEIGHT = 736;
const APP_PROTOCOL = "amethyst";
const APP_PROTOCOL_HOST = "app";
const APP_ORIGIN = `${APP_PROTOCOL}://${APP_PROTOCOL_HOST}`;

const DIST_DIR = path.resolve(__dirname, "..", "built-web");

function resolveAppIconPath() {
  // Linux cannot reliably use BrowserWindow icons from inside app.asar, so the
  // packaged build copies build/icon.png to resources/ via extraResources.
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(DIST_DIR, "icons", "icon-512x512.png"),
    path.join(__dirname, "..", "build", "icon.png"),
  ];
  for (const candidate of candidates) {
    try {
      fsSync.accessSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

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
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
};

function resolveUserDataDir() {
  const defaultUserDataDir = app.getPath("userData");
  const defaultLeaf = path.basename(defaultUserDataDir);
  if (defaultLeaf.toLowerCase().includes("amethystxmr")) {
    return defaultUserDataDir;
  }
  return path.join(path.dirname(defaultUserDataDir), "amethystxmr");
}

app.setPath("userData", resolveUserDataDir());

let mainWindow = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
  process.exit(0);
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
  let rawPath;
  try {
    rawPath = decodeURIComponent(requestPathname || "/");
  } catch {
    return null;
  }
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

function makeTextResponse(status, text) {
  return new Response(text, {
    status,
    headers: {
      ...securityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

async function handleAppProtocol(request) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return makeTextResponse(400, "Bad request");
  }

  if (
    requestUrl.protocol !== `${APP_PROTOCOL}:` ||
    requestUrl.host !== APP_PROTOCOL_HOST
  ) {
    return makeTextResponse(404, "Not found");
  }

  const served = await readServedFile(requestUrl.pathname);
  if (!served) {
    return makeTextResponse(404, "Not found");
  }

  return new Response(served.content, {
    status: 200,
    headers: {
      ...securityHeaders(),
      "Content-Type": getContentType(served.filePath),
    },
  });
}

async function registerAppProtocol() {
  await protocol.handle(APP_PROTOCOL, handleAppProtocol);
}

function isSafeExternalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function createWindow(baseUrl) {
  // Do not set min/max width/height here: those constrain the outer frame, so
  // pairing them with useContentSize shrinks the viewport below APP_* and
  // creates an unwanted page scrollbar. resizable:false keeps the size fixed.
  const appIconPath = resolveAppIconPath();
  const win = new BrowserWindow({
    useContentSize: true,
    width: APP_WIDTH,
    height: APP_HEIGHT,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#281549",
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => {
    win.setContentSize(APP_WIDTH, APP_HEIGHT);
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
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
  await registerAppProtocol();
  createWindow(`${APP_ORIGIN}/`);
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
