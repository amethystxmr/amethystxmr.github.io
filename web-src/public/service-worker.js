self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

function shouldAddCrossOriginIsolationHeaders(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname.endsWith(".wasm")) {
    return false;
  }
  if (request.mode === "navigate") {
    return true;
  }
  if (request.headers.get("accept")?.includes("text/html")) {
    return true;
  }
  if (request.destination === "worker" || request.destination === "script") {
    return true;
  }
  return false;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }
  if (!shouldAddCrossOriginIsolationHeaders(request)) {
    return;
  }
  event.respondWith(
    fetch(request).then((response) => {
      if (!response || response.status === 0) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
});
