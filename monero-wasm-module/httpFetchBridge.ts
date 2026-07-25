import {
  type HttpFetchCallback,
  type HttpFetchEvent,
  type HttpFetchState,
} from "./walletApi";

export type { HttpFetchCallback, HttpFetchEvent, HttpFetchState };

let httpFetchEventChannel: BroadcastChannel | null = null;
let httpFetchCallback: HttpFetchCallback | null = null;
let httpFetchWasmMemory: WebAssembly.Memory | null = null;

const HTTP_FETCH_FAILURE_NONE = 0;
const HTTP_FETCH_FAILURE_ERROR = 1;
const HTTP_FETCH_FAILURE_TIMEOUT = 2;
const HTTP_FETCH_FAILURE_ABORT = 3;
const HTTP_FETCH_FAILURE_PROTOCOL_ERROR = 4;
const LOCK_DONE = 2;
const LOCK_ERROR = 3;
const MAX_I32 = 0x7fffffff;

// Threads-mode HTTP uses a synchronous two-phase handoff. The WASM worker asks
// the UI thread to fetch, waits for response sizes, allocates C++ strings, then
// asks the UI thread to copy bytes into the newly allocated addresses. Channel
// messages carry only cloneable metadata; the UI reads a fresh buffer from the
// registered WebAssembly.Memory because memory.buffer can change after growth.
type HttpFetchRequestMessage = {
  type: "amethyst-http-fetch-request";
  url: string;
  requestUrl: string;
  method: string;
  bodyPtr: number;
  bodyLen: number;
  timeoutMs: number;
  requestIdHi: number;
  requestIdLo: number;
  phaseOneLockPtr: number;
  responseCodePtr: number;
  failureStatePtr: number;
  bodySizePtr: number;
  mimeSizePtr: number;
};

type HttpFetchCopyResponseMessage = {
  type: "amethyst-http-fetch-copy-response";
  requestIdHi: number;
  requestIdLo: number;
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
  const bodyPtr = getPointerMessageProperty(value, "bodyPtr");
  const bodyLen = getPointerMessageProperty(value, "bodyLen");
  const timeoutMs = getNumberMessageProperty(value, "timeoutMs");
  const requestIdHi = getUint32MessageProperty(value, "requestIdHi");
  const requestIdLo = getUint32MessageProperty(value, "requestIdLo");
  const phaseOneLockPtr = getPointerMessageProperty(value, "phaseOneLockPtr");
  const responseCodePtr = getPointerMessageProperty(value, "responseCodePtr");
  const failureStatePtr = getPointerMessageProperty(value, "failureStatePtr");
  const bodySizePtr = getPointerMessageProperty(value, "bodySizePtr");
  const mimeSizePtr = getPointerMessageProperty(value, "mimeSizePtr");

  if (
    !url ||
    !requestUrl ||
    !method ||
    bodyPtr === null ||
    bodyLen === null ||
    timeoutMs === null ||
    requestIdHi === null ||
    requestIdLo === null ||
    phaseOneLockPtr === null ||
    responseCodePtr === null ||
    failureStatePtr === null ||
    bodySizePtr === null ||
    mimeSizePtr === null
  ) {
    return null;
  }

  return {
    type: "amethyst-http-fetch-request",
    url,
    requestUrl,
    method,
    bodyPtr,
    bodyLen,
    timeoutMs,
    requestIdHi,
    requestIdLo,
    phaseOneLockPtr,
    responseCodePtr,
    failureStatePtr,
    bodySizePtr,
    mimeSizePtr,
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
  const phaseTwoLockPtr = getPointerMessageProperty(value, "phaseTwoLockPtr");
  const bodySizePtr = getPointerMessageProperty(value, "bodySizePtr");
  const mimeSizePtr = getPointerMessageProperty(value, "mimeSizePtr");
  const bodyDataPtrPtr = getPointerMessageProperty(value, "bodyDataPtrPtr");
  const mimeDataPtrPtr = getPointerMessageProperty(value, "mimeDataPtrPtr");

  if (
    requestIdHi === null ||
    requestIdLo === null ||
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

function getHttpFetchWasmMemoryBuffer() {
  if (!httpFetchWasmMemory) {
    throw new Error("HTTP fetch WASM memory is not initialized");
  }
  const buffer = httpFetchWasmMemory.buffer;
  if (!(buffer instanceof SharedArrayBuffer)) {
    throw new Error("HTTP fetch WASM memory is not shared");
  }
  return buffer;
}

function heapI32() {
  return new Int32Array(getHttpFetchWasmMemoryBuffer());
}

function heapU8() {
  return new Uint8Array(getHttpFetchWasmMemoryBuffer());
}

function storeI32(ptr: number, value: number) {
  Atomics.store(heapI32(), ptr >> 2, value);
}

function loadI32(ptr: number) {
  return Atomics.load(heapI32(), ptr >> 2);
}

function notifyLock(lockPtr: number, value: number) {
  const locks = heapI32();
  const lockIndex = lockPtr >> 2;
  Atomics.store(locks, lockIndex, value);
  Atomics.notify(locks, lockIndex);
}

function writeFetchOutcome(
  request: HttpFetchRequestMessage,
  outcome: HttpFetchOutcome,
) {
  storeI32(request.responseCodePtr, outcome.responseCode);
  storeI32(request.failureStatePtr, outcome.failureState);
  storeI32(request.bodySizePtr, outcome.bodyBytes.length);
  storeI32(request.mimeSizePtr, outcome.mimeBytes.length);
}

function notifyMalformedHttpFetchRequest(value: object) {
  const phaseOneLockPtr = getPointerMessageProperty(value, "phaseOneLockPtr");
  const responseCodePtr = getPointerMessageProperty(value, "responseCodePtr");
  const failureStatePtr = getPointerMessageProperty(value, "failureStatePtr");
  const bodySizePtr = getPointerMessageProperty(value, "bodySizePtr");
  const mimeSizePtr = getPointerMessageProperty(value, "mimeSizePtr");
  if (
    phaseOneLockPtr === null ||
    responseCodePtr === null ||
    failureStatePtr === null ||
    bodySizePtr === null ||
    mimeSizePtr === null
  ) {
    return;
  }
  storeI32(responseCodePtr, 0);
  storeI32(failureStatePtr, HTTP_FETCH_FAILURE_PROTOCOL_ERROR);
  storeI32(bodySizePtr, 0);
  storeI32(mimeSizePtr, 0);
  notifyLock(phaseOneLockPtr, LOCK_ERROR);
}

function notifyMalformedHttpFetchCopyResponse(value: object) {
  const phaseTwoLockPtr = getPointerMessageProperty(value, "phaseTwoLockPtr");
  if (phaseTwoLockPtr === null) {
    return;
  }
  notifyLock(phaseTwoLockPtr, LOCK_ERROR);
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

function requestBodyInit(request: HttpFetchRequestMessage) {
  if (
    request.method === "GET" ||
    request.bodyPtr === 0 ||
    request.bodyLen === 0
  ) {
    return undefined;
  }
  const bodyEnd = request.bodyPtr + request.bodyLen;
  const source = heapU8();
  if (bodyEnd < request.bodyPtr || bodyEnd > source.byteLength) {
    throw new Error("HTTP request body is outside WASM memory");
  }
  const requestBody = new ArrayBuffer(request.bodyLen);
  new Uint8Array(requestBody).set(source.subarray(request.bodyPtr, bodyEnd));
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
      body: requestBodyInit(request),
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
  let outcome: HttpFetchOutcome;
  try {
    outcome = await fetchHttpResponse(request);
  } catch {
    outcome = failureOutcome(HTTP_FETCH_FAILURE_PROTOCOL_ERROR);
  }

  try {
    writeFetchOutcome(request, outcome);
    const hasResponseBytes =
      outcome.bodyBytes.length > 0 || outcome.mimeBytes.length > 0;
    if (outcome.failureState === HTTP_FETCH_FAILURE_NONE && hasResponseBytes) {
      pendingHttpFetchResponses.set(key, {
        bodyBytes: outcome.bodyBytes,
        mimeBytes: outcome.mimeBytes,
      });
    } else {
      pendingHttpFetchResponses.delete(key);
    }
    notifyLock(request.phaseOneLockPtr, LOCK_DONE);
  } catch {
    pendingHttpFetchResponses.delete(key);
    notifyLock(request.phaseOneLockPtr, LOCK_ERROR);
  }
}

function handleHttpFetchCopyResponse(message: HttpFetchCopyResponseMessage) {
  const key = requestKey(message.requestIdHi, message.requestIdLo);
  const pending = pendingHttpFetchResponses.get(key);
  pendingHttpFetchResponses.delete(key);

  if (!pending) {
    notifyLock(message.phaseTwoLockPtr, LOCK_ERROR);
    return;
  }

  try {
    const bodySize = loadI32(message.bodySizePtr);
    const mimeSize = loadI32(message.mimeSizePtr);
    const bodyDataPtr = loadI32(message.bodyDataPtrPtr) >>> 0;
    const mimeDataPtr = loadI32(message.mimeDataPtrPtr) >>> 0;

    if (
      bodySize !== pending.bodyBytes.length ||
      mimeSize !== pending.mimeBytes.length ||
      (bodyDataPtr === 0 && bodySize > 0) ||
      (mimeDataPtr === 0 && mimeSize > 0)
    ) {
      notifyLock(message.phaseTwoLockPtr, LOCK_ERROR);
      return;
    }

    const out = heapU8();
    if (mimeSize > 0) {
      out.set(pending.mimeBytes, mimeDataPtr);
    }
    if (bodySize > 0) {
      out.set(pending.bodyBytes, bodyDataPtr);
    }
    notifyLock(message.phaseTwoLockPtr, LOCK_DONE);
  } catch {
    notifyLock(message.phaseTwoLockPtr, LOCK_ERROR);
  }
}

function handleHttpFetchChannelMessage(value: unknown) {
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

export function setHttpFetchWasmMemory(memory: WebAssembly.Memory) {
  httpFetchWasmMemory = memory;
}

export const setHttpFetchCallback = (
  callback: HttpFetchCallback | null,
): void => {
  httpFetchCallback = callback;
  ensureHttpFetchEventChannel();
};
