const {
  app,
  BrowserWindow,
  shell,
  protocol,
  nativeImage,
  net,
} = require("electron");
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
const DAEMON_PROXY_PATH = "/__daemon_rpc";
// Must match package.json desktopName / Linux executable basename so GNOME
// Wayland can associate the running window with the desktop entry + icon.
const LINUX_DESKTOP_FILE_NAME = "amethystxmr.desktop";
const LINUX_ICON_NAME = "org.amethystxmr.wallet";

const DIST_DIR = path.resolve(__dirname, "..", "built-web");

if (process.platform === "linux") {
  // Override inherited values (e.g. CHROME_DESKTOP=cursor.desktop from an IDE).
  process.env.CHROME_DESKTOP = LINUX_DESKTOP_FILE_NAME;
}

function resolveAppIconPath() {
  // Linux cannot reliably use BrowserWindow icons from inside app.asar, so the
  // packaged build copies electron/images/icon.png to resources/ via extraResources.
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(DIST_DIR, "icons", "icon-512x512.png"),
    path.join(__dirname, "images", "icon.png"),
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

function quoteDesktopExec(filePath) {
  if (/[\r\n]/.test(filePath)) {
    return null;
  }
  const escaped = filePath.replace(/%/g, "%%").replace(/(["\\$`])/g, "\\$1");
  if (/^[A-Za-z0-9._/-]+$/.test(filePath)) {
    return escaped;
  }
  return `"${escaped}"`;
}

function ensureLinuxDesktopIntegration(iconPath) {
  // Ubuntu 24 / GNOME ignores BrowserWindow.setIcon for the dock. The dock icon
  // comes from a user .desktop entry whose basename matches Wayland app_id /
  // CHROME_DESKTOP, with an icon installed into the hicolor theme.
  if (process.platform !== "linux" || !app.isPackaged || !iconPath) {
    return;
  }

  const home = app.getPath("home");
  const applicationsDir = path.join(home, ".local", "share", "applications");
  const iconDir = path.join(
    home,
    ".local",
    "share",
    "icons",
    "hicolor",
    "512x512",
    "apps",
  );
  const desktopPath = path.join(applicationsDir, LINUX_DESKTOP_FILE_NAME);
  const installedIconPath = path.join(iconDir, `${LINUX_ICON_NAME}.png`);
  const execPath = process.env.APPIMAGE || process.execPath;
  const quotedExecPath = quoteDesktopExec(execPath);
  if (!quotedExecPath) {
    return;
  }

  try {
    fsSync.mkdirSync(applicationsDir, { recursive: true });
    fsSync.mkdirSync(iconDir, { recursive: true });
    fsSync.copyFileSync(iconPath, installedIconPath);

    const desktopEntry = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=AmethystXMR",
      "Comment=Amethyst XMR is a web-based Monero wallet",
      `Exec=${quotedExecPath} %U`,
      `Icon=${LINUX_ICON_NAME}`,
      "Terminal=false",
      "Categories=Finance;",
      "StartupWMClass=amethystxmr",
      "",
    ].join("\n");

    let previous = "";
    try {
      previous = fsSync.readFileSync(desktopPath, "utf8");
    } catch {
      // first install
    }
    if (previous !== desktopEntry) {
      fsSync.writeFileSync(desktopPath, desktopEntry);
    }

    // Remove earlier mistaken desktop id from this PR's first iterations.
    try {
      fsSync.unlinkSync(path.join(applicationsDir, "AmethystXMR.desktop"));
    } catch {
      // absent
    }
  } catch (error) {
    console.warn("Could not install Linux desktop integration:", error);
  }
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
  const candidate = path.resolve(
    DIST_DIR,
    `.${normalized.startsWith("/") ? normalized : `/${normalized}`}`,
  );

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

function isSupportedDaemonUrl(url) {
  return url.protocol === "http:" || url.protocol === "https:";
}

async function handleDaemonProxy(requestUrl, request) {
  const target = requestUrl.searchParams.get("target");
  if (!target) {
    return makeTextResponse(400, "Missing daemon target");
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return makeTextResponse(400, "Invalid daemon target");
  }

  if (!isSupportedDaemonUrl(targetUrl)) {
    return makeTextResponse(400, "Unsupported daemon target");
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return makeTextResponse(405, "Unsupported daemon method");
  }

  try {
    const requestInit = {
      method: request.method,
      redirect: "follow",
    };
    if (request.method !== "GET") {
      requestInit.body = Buffer.from(await request.arrayBuffer());
    }

    const upstream = await net.fetch(targetUrl.href, requestInit);
    const headers = new Headers({
      ...securityHeaders(),
      "Content-Type":
        upstream.headers.get("Content-Type") || "application/octet-stream",
    });
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.warn("Daemon proxy request failed:", error);
    return makeTextResponse(502, "Daemon request failed");
  }
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

  if (requestUrl.pathname === DAEMON_PROXY_PATH) {
    return handleDaemonProxy(requestUrl, request);
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
  const appIcon = appIconPath
    ? nativeImage.createFromPath(appIconPath)
    : undefined;
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
    ...(appIcon && !appIcon.isEmpty() ? { icon: appIcon } : {}),
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
  ensureLinuxDesktopIntegration(resolveAppIconPath());
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
