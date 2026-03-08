const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("amethystRuntime", {
  isNativeApp: true,
});
