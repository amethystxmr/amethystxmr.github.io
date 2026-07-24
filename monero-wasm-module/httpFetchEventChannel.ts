import {
  type HttpFetchCallback,
  type HttpFetchEvent,
  type HttpFetchState,
} from "./walletApi";

export type { HttpFetchCallback, HttpFetchEvent, HttpFetchState };

let httpFetchEventChannel: BroadcastChannel | null = null;
let httpFetchCallback: HttpFetchCallback | null = null;

const HTTP_FETCH_FAILURE_NONE = 0;
const HTTP_FETCH_FAILURE_ERROR = 1;
const HTTP_FETCH_FAILURE_TIMEOUT = 2;
const HTTP_FETCH_FAILURE_ABORT = 3;
const HTTP_FETCH_FAILURE_PROTOCOL_ERROR = 4;
const LOCK_OK = 1;
const LOCK_ERROR = 2;
const MAX_I32 = 0x7fffffff;

// Threads-mode HTTP uses a synchronous two-phase handoff. The WASM worker asks
// the UI thread to fetch, waits for response sizes, allocates C++ strings, then
// asks the UI thread to copy bytes into the newly allocated addresses.
type HttpFetchRequestMessage = {
  type: "amethyst-http-fetch-request";
  url: string;
  requestUrl: string;
  method: string;
  body: Uint8Array | null;
  timeoutMs: number;
  requestIdHi: number;
  requestIdLo: number;
  wasmMemory: WebAssembly.Memory;
  phaseOneLockPtr: number;
  phaseTwoLockPtr: number;
  responseCodePtr: number;
  failureStatePtr: number;
  bodySizePtr: number;
  mimeSizePtr: number;
  bodyDataPtrPtr: number;
  mimeDataPtrPtr: number;
};

type HttpFetchCopyResponseMessage = {
  type: "amethyst-http-fetch-copy-response";
  requestIdHi: number;
  requestIdLo: number;
  wasmMemory: WebAssembly.Memory;
  phaseTwoLockPtr: number;
  bodySizePtr: number;
  mimeSizePtr: number;
  bodyDataPtrPtr: number;
  mimeDataPtrPtr: number;
};

type HttpFetchOutcome = {
  responseCode: number;
  failureState: number;
  bodyBytes: Uint8Array;
  mimeBytes: Uint8Array;
};

type PendingHttpFetchResponse = {
  bodyBytes: Uint8Array;
  mimeBytes: Uint8Array;
};

const pendingHttpFetchResponses = new Map<string, PendingHttpFetchResponse>();
const activeHttpFetchRequests = new Set<string>();
const completedHttpFetchRequests = new Set<string>();
const textEncoder = new TextEncoder();

function createHttpFetchEventChannelName() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `amethyst-http-fetch-${randomId}`;
}

export const httpFetchEventChannelName = createHttpFetchEventChannelName();

function getStringMessageProperty(value: object, property: string) {
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : null;
}

function getNumberMessageProperty(value: object, property: string) {
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "number" && Number.isFinite(propertyValue)
    ? propertyValue
    : null;
}

function getUint32MessageProperty(value: object, property: string) {
  const propertyValue = getNumberMessageProperty(value, property);
  return propertyValue !== null &&
    Number.isInteger(propertyValue) &&
    propertyValue >= 0 &&
    propertyValue <= 0xffffffff
    ? propertyValue
    : null;
}

function getPointerMessageProperty(value: object, property: string) {
  const propertyValue = getNumberMessageProperty(value, property);
  return propertyValue !== null &&
    Number.isInteger(propertyValue) &&
    propertyValue >= 0
    ? propertyValue
    : null;
}

function getOptionalUint8ArrayMessageProperty(value: object, property: string) {
  const propertyValue = Reflect.get(value, property);
  if (propertyValue === undefined || propertyValue === null) {
    return null;
  }
  return propertyValue instanceof Uint8Array ? propertyValue : null;
}

function isWasmMemory(value: unknown): value is WebAssembly.Memory {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const buffer = Reflect.get(value, "buffer");
  // Structured-cloned WebAssembly.Memory can cross realms, so checking the
  // shared backing buffer is more reliable here than instanceof Memory.
  return (
    typeof SharedArrayBuffer === "function" &&
    buffer instanceof SharedArrayBuffer
  );
}

function getWasmMemoryMessageProperty(value: object, property: string) {
  const propertyValue = Reflect.get(value, property);
  return isWasmMemory(propertyValue) ? propertyValue : null;
}

function parseHttpFetchState(value: string | null): HttpFetchState | null {
  switch (value) {
    case "start":
    case "progress":
    case "end":
    case "error":
    case "timeout":
    case "abort":
      return value;
    default:
      return null;
  }
}

function parseHttpFetchEvent(value: unknown): HttpFetchEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const url = getStringMessageProperty(value, "url");
  const reqId = getStringMessageProperty(value, "reqId");
  const state = parseHttpFetchState(getStringMessageProperty(value, "state"));
  const progressLoaded = getNumberMessageProperty(value, "progressLoaded");
  const progressTotal = getNumberMessageProperty(value, "progressTotal");

  if (
    !url ||
    !reqId ||
    !state ||
    progressLoaded === null ||
    progressTotal === null
  ) {
    return null;
  }

  return { url, reqId, state, progressLoaded, progressTotal };
}

function parseHttpFetchRequestMessage(
  value: object,
): HttpFetchRequestMessage | null {
  if (
    getStringMessageProperty(value, "type") !== "amethyst-http-fetch-request"
  ) {
    return null;
  }

  const url = getStringMessageProperty(value, "url");
  const requestUrl = getStringMessageProperty(value, "requestUrl");
  const method = getStringMessageProperty(value, "method");
  const body = getOptionalUint8ArrayMessageProperty(value, "body");
  const timeoutMs = getNumberMessageProperty(value, "timeoutMs");
  const requestIdHi = getUint32MessageProperty(value, "requestIdHi");
  const requestIdLo = getUint32MessageProperty(value, "requestIdLo");
  const wasmMemory = getWasmMemoryMessageProperty(value, "wasmMemory");
  const phaseOneLockPtr = getPointerMessageProperty(value, "phaseOneLockPtr");
  const phaseTwoLockPtr = getPointerMessageProperty(value, "phaseTwoLockPtr");
  const responseCodePtr = getPointerMessageProperty(value, "responseCodePtr");
  const failureStatePtr = getPointerMessageProperty(value, "failureStatePtr");
  const bodySizePtr = getPointerMessageProperty(value, "bodySizePtr");
  const mimeSizePtr = getPointerMessageProperty(value, "mimeSizePtr");
  const bodyDataPtrPtr = getPointerMessageProperty(value, "bodyDataPtrPtr");
  const mimeDataPtrPtr = getPointerMessageProperty(value, "mimeDataPtrPtr");

  if (
    !url ||
    !requestUrl ||
    !method ||
    timeoutMs === null ||
    requestIdHi === null ||
    requestIdLo === null ||
    !wasmMemory ||
    phaseOneLockPtr === null ||
    phaseTwoLockPtr === null ||
    responseCodePtr === null ||
    failureStatePtr === null ||
    bodySizePtr === null ||
    mimeSizePtr === null ||
    bodyDataPtrPtr === null ||
    mimeDataPtrPtr === null
  ) {
    return null;
  }

  return {
    type: "amethyst-http-fetch-request",
    url,
    requestUrl,
    method,
    body,
    timeoutMs,
    requestIdHi,
    requestIdLo,
    wasmMemory,
    phaseOneLockPtr,
    phaseTwoLockPtr,
    responseCodePtr,
    failureStatePtr,
    bodySizePtr,
    mimeSizePtr,
    bodyDataPtrPtr,
    mimeDataPtrPtr,
  };
}

function parseHttpFetchCopyResponseMessage(
  value: object,
): HttpFetchCopyResponseMessage | null {
  if (
    getStringMessageProperty(value, "type") !==
    "amethyst-http-fetch-copy-response"
  ) {
    return null;
  }

  const requestIdHi = getUint32MessageProperty(value, "requestIdHi");
  const requestIdLo = getUint32MessageProperty(value, "requestIdLo");
  const wasmMemory = getWasmMemoryMessageProperty(value, "wasmMemory");
  const phaseTwoLockPtr = getPointerMessageProperty(value, "phaseTwoLockPtr");
  const bodySizePtr = getPointerMessageProperty(value, "bodySizePtr");
  const mimeSizePtr = getPointerMessageProperty(value, "mimeSizePtr");
  const bodyDataPtrPtr = getPointerMessageProperty(value, "bodyDataPtrPtr");
  const mimeDataPtrPtr = getPointerMessageProperty(value, "mimeDataPtrPtr");

  if (
    requestIdHi === null ||
    requestIdLo === null ||
    !wasmMemory ||
    phaseTwoLockPtr === null ||
    bodySizePtr === null ||
    mimeSizePtr === null ||
    bodyDataPtrPtr === null ||
    mimeDataPtrPtr === null
  ) {
    return null;
  }

  return {
    type: "amethyst-http-fetch-copy-response",
    requestIdHi,
    requestIdLo,
    wasmMemory,
    phaseTwoLockPtr,
    bodySizePtr,
    mimeSizePtr,
    bodyDataPtrPtr,
    mimeDataPtrPtr,
  };
}

function requestKey(requestIdHi: number, requestIdLo: number) {
  return `${requestIdHi}:${requestIdLo}`;
}

function requestIdText(requestIdHi: number, requestIdLo: number) {
  return `${requestIdHi.toString(16).padStart(8, "0")}${requestIdLo
    .toString(16)
    .padStart(8, "0")}`;
}

function emitHttpFetchCallback(
  url: string,
  requestIdHi: number,
  requestIdLo: number,
  state: HttpFetchState,
  progressLoaded: number,
  progressTotal: number,
) {
  httpFetchCallback?.(
    url,
    requestIdText(requestIdHi, requestIdLo),
    state,
    progressLoaded,
    progressTotal,
  );
}

function rememberCompletedRequest(key: string) {
  completedHttpFetchRequests.add(key);
  globalThis.setTimeout(() => {
    completedHttpFetchRequests.delete(key);
  }, 60_000);
}

function heapI32(memory: WebAssembly.Memory) {
  return new Int32Array(memory.buffer);
}

function heapU8(memory: WebAssembly.Memory) {
  return new Uint8Array(memory.buffer);
}

function storeI32(memory: WebAssembly.Memory, ptr: number, value: number) {
  Atomics.store(heapI32(memory), ptr >> 2, value);
}

function loadI32(memory: WebAssembly.Memory, ptr: number) {
  return Atomics.load(heapI32(memory), ptr >> 2);
}

function notifyLock(
  memory: WebAssembly.Memory,
  lockPtr: number,
  value: number,
) {
  const locks = heapI32(memory);
  const lockIndex = lockPtr >> 2;
  Atomics.store(locks, lockIndex, value);
  Atomics.notify(locks, lockIndex);
}

function writeFetchOutcome(
  request: HttpFetchRequestMessage,
  outcome: HttpFetchOutcome,
) {
  storeI32(request.wasmMemory, request.responseCodePtr, outcome.responseCode);
  storeI32(request.wasmMemory, request.failureStatePtr, outcome.failureState);
  storeI32(request.wasmMemory, request.bodySizePtr, outcome.bodyBytes.length);
  storeI32(request.wasmMemory, request.mimeSizePtr, outcome.mimeBytes.length);
}

function notifyMalformedHttpFetchRequest(value: object) {
  const wasmMemory = getWasmMemoryMessageProperty(value, "wasmMemory");
  const phaseOneLockPtr = getPointerMessageProperty(value, "phaseOneLockPtr");
  const responseCodePtr = getPointerMessageProperty(value, "responseCodePtr");
  const failureStatePtr = getPointerMessageProperty(value, "failureStatePtr");
  const bodySizePtr = getPointerMessageProperty(value, "bodySizePtr");
  const mimeSizePtr = getPointerMessageProperty(value, "mimeSizePtr");
  if (
    !wasmMemory ||
    phaseOneLockPtr === null ||
    responseCodePtr === null ||
    failureStatePtr === null ||
    bodySizePtr === null ||
    mimeSizePtr === null
  ) {
    return;
  }
  storeI32(wasmMemory, responseCodePtr, 0);
  storeI32(wasmMemory, failureStatePtr, HTTP_FETCH_FAILURE_PROTOCOL_ERROR);
  storeI32(wasmMemory, bodySizePtr, 0);
  storeI32(wasmMemory, mimeSizePtr, 0);
  notifyLock(wasmMemory, phaseOneLockPtr, LOCK_ERROR);
}

function notifyMalformedHttpFetchCopyResponse(value: object) {
  const wasmMemory = getWasmMemoryMessageProperty(value, "wasmMemory");
  const phaseTwoLockPtr = getPointerMessageProperty(value, "phaseTwoLockPtr");
  if (!wasmMemory || phaseTwoLockPtr === null) {
    return;
  }
  notifyLock(wasmMemory, phaseTwoLockPtr, LOCK_ERROR);
}

function parseContentLength(response: Response) {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength === null) {
    return null;
  }
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function concatChunks(chunks: Uint8Array[], size: number) {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readResponseBody(
  response: Response,
  progressTotal: number | null,
  onProgress: (loaded: number, total: number) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (progressTotal !== null) {
      onProgress(body.byteLength, progressTotal);
    }
    return body;
  }

  const chunks: Uint8Array[] = [];
  let progressLoaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    chunks.push(value);
    progressLoaded += value.byteLength;
    if (progressTotal !== null) {
      onProgress(progressLoaded, progressTotal);
    }
  }
  return concatChunks(chunks, progressLoaded);
}

function failureOutcome(failureState: number): HttpFetchOutcome {
  return {
    responseCode: 0,
    failureState,
    bodyBytes: new Uint8Array(0),
    mimeBytes: new Uint8Array(0),
  };
}

function requestBodyInit(method: string, body: Uint8Array | null) {
  if (method === "GET" || !body || body.byteLength === 0) {
    return undefined;
  }
  const requestBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(requestBody).set(body);
  return requestBody;
}

async function fetchHttpResponse(
  request: HttpFetchRequestMessage,
): Promise<HttpFetchOutcome> {
  const controller = new AbortController();
  let timeoutReached = false;
  const timeoutId =
    request.timeoutMs > 0
      ? window.setTimeout(() => {
          timeoutReached = true;
          controller.abort();
        }, request.timeoutMs)
      : null;

  emitHttpFetchCallback(
    request.url,
    request.requestIdHi,
    request.requestIdLo,
    "start",
    0,
    0,
  );

  try {
    const response = await fetch(request.requestUrl, {
      method: request.method,
      body: requestBodyInit(request.method, request.body),
      signal: controller.signal,
    });

    if (response.status === 0) {
      emitHttpFetchCallback(
        request.url,
        request.requestIdHi,
        request.requestIdLo,
        "error",
        0,
        0,
      );
      return failureOutcome(HTTP_FETCH_FAILURE_ERROR);
    }

    const progressTotal = parseContentLength(response);
    const bodyBytes = await readResponseBody(
      response,
      progressTotal,
      (progressLoaded, progressTotal) => {
        emitHttpFetchCallback(
          request.url,
          request.requestIdHi,
          request.requestIdLo,
          "progress",
          progressLoaded,
          progressTotal,
        );
      },
    );
    const mimeBytes = textEncoder.encode(
      response.headers.get("Content-Type") ?? "",
    );

    if (bodyBytes.length > MAX_I32 || mimeBytes.length > MAX_I32) {
      emitHttpFetchCallback(
        request.url,
        request.requestIdHi,
        request.requestIdLo,
        "error",
        0,
        0,
      );
      return failureOutcome(HTTP_FETCH_FAILURE_PROTOCOL_ERROR);
    }

    emitHttpFetchCallback(
      request.url,
      request.requestIdHi,
      request.requestIdLo,
      "end",
      bodyBytes.length,
      bodyBytes.length,
    );
    return {
      responseCode: response.status,
      failureState: HTTP_FETCH_FAILURE_NONE,
      bodyBytes,
      mimeBytes,
    };
  } catch (e) {
    const state: HttpFetchState = timeoutReached
      ? "timeout"
      : e instanceof DOMException && e.name === "AbortError"
        ? "abort"
        : "error";
    emitHttpFetchCallback(
      request.url,
      request.requestIdHi,
      request.requestIdLo,
      state,
      0,
      0,
    );
    return failureOutcome(
      state === "timeout"
        ? HTTP_FETCH_FAILURE_TIMEOUT
        : state === "abort"
          ? HTTP_FETCH_FAILURE_ABORT
          : HTTP_FETCH_FAILURE_ERROR,
    );
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function handleHttpFetchRequest(request: HttpFetchRequestMessage) {
  const key = requestKey(request.requestIdHi, request.requestIdLo);
  // The outer module worker sends through both BroadcastChannel and parent
  // postMessage; nested pthread workers use BroadcastChannel only. De-dupe here
  // so the bridge stays idempotent when both outer-worker paths arrive.
  if (
    activeHttpFetchRequests.has(key) ||
    pendingHttpFetchResponses.has(key) ||
    completedHttpFetchRequests.has(key)
  ) {
    return;
  }
  activeHttpFetchRequests.add(key);
  let outcome: HttpFetchOutcome;
  try {
    outcome = await fetchHttpResponse(request);
  } catch {
    outcome = failureOutcome(HTTP_FETCH_FAILURE_PROTOCOL_ERROR);
  } finally {
    activeHttpFetchRequests.delete(key);
  }

  writeFetchOutcome(request, outcome);
  if (
    outcome.failureState === HTTP_FETCH_FAILURE_NONE &&
    (outcome.bodyBytes.length > 0 || outcome.mimeBytes.length > 0)
  ) {
    pendingHttpFetchResponses.set(key, {
      bodyBytes: outcome.bodyBytes,
      mimeBytes: outcome.mimeBytes,
    });
  } else {
    pendingHttpFetchResponses.delete(key);
    rememberCompletedRequest(key);
  }
  notifyLock(request.wasmMemory, request.phaseOneLockPtr, LOCK_OK);
}

function handleHttpFetchCopyResponse(message: HttpFetchCopyResponseMessage) {
  const key = requestKey(message.requestIdHi, message.requestIdLo);
  const pending = pendingHttpFetchResponses.get(key);
  pendingHttpFetchResponses.delete(key);
  if (!pending) {
    if (!completedHttpFetchRequests.has(key)) {
      notifyLock(message.wasmMemory, message.phaseTwoLockPtr, LOCK_ERROR);
    }
    return;
  }

  // The worker sends WebAssembly.Memory again after allocating response strings:
  // the Memory object is stable, but ALLOW_MEMORY_GROWTH can replace its
  // .buffer. Fresh views avoid writing through a stale SharedArrayBuffer.
  const bodySize = loadI32(message.wasmMemory, message.bodySizePtr);
  const mimeSize = loadI32(message.wasmMemory, message.mimeSizePtr);
  const bodyDataPtr = loadI32(message.wasmMemory, message.bodyDataPtrPtr) >>> 0;
  const mimeDataPtr = loadI32(message.wasmMemory, message.mimeDataPtrPtr) >>> 0;

  if (
    bodySize !== pending.bodyBytes.length ||
    mimeSize !== pending.mimeBytes.length ||
    (bodyDataPtr === 0 && bodySize > 0) ||
    (mimeDataPtr === 0 && mimeSize > 0)
  ) {
    notifyLock(message.wasmMemory, message.phaseTwoLockPtr, LOCK_ERROR);
    return;
  }

  const out = heapU8(message.wasmMemory);
  if (mimeSize > 0) {
    out.set(pending.mimeBytes, mimeDataPtr);
  }
  if (bodySize > 0) {
    out.set(pending.bodyBytes, bodyDataPtr);
  }
  rememberCompletedRequest(key);
  notifyLock(message.wasmMemory, message.phaseTwoLockPtr, LOCK_OK);
}

export function handleHttpFetchChannelMessage(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return;
  }

  const messageType = getStringMessageProperty(value, "type");
  const request = parseHttpFetchRequestMessage(value);
  if (request) {
    // Pthread WASM cannot do async browser fetch while synchronously blocked in
    // wallet RPC, so the UI thread downloads and copies bytes back into WASM.
    void handleHttpFetchRequest(request);
    return;
  }
  if (messageType === "amethyst-http-fetch-request") {
    notifyMalformedHttpFetchRequest(value);
    return;
  }

  const copyResponse = parseHttpFetchCopyResponseMessage(value);
  if (copyResponse) {
    handleHttpFetchCopyResponse(copyResponse);
    return;
  }
  if (messageType === "amethyst-http-fetch-copy-response") {
    notifyMalformedHttpFetchCopyResponse(value);
    return;
  }

  const event = parseHttpFetchEvent(value);
  if (!event || !httpFetchCallback) {
    return;
  }
  httpFetchCallback(
    event.url,
    event.reqId,
    event.state,
    event.progressLoaded,
    event.progressTotal,
  );
}

export function ensureHttpFetchEventChannel() {
  if (httpFetchEventChannel) {
    return;
  }

  httpFetchEventChannel = new BroadcastChannel(httpFetchEventChannelName);
  httpFetchEventChannel.onmessage = (message) => {
    handleHttpFetchChannelMessage(message.data);
  };
}

export const setHttpFetchCallback = (
  callback: HttpFetchCallback | null,
): void => {
  httpFetchCallback = callback;
  ensureHttpFetchEventChannel();
};
