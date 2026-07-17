import {
  type HttpFetchCallback,
  type HttpFetchEvent,
  type HttpFetchState,
} from "./walletApi";

export type { HttpFetchCallback, HttpFetchEvent, HttpFetchState };

let httpFetchEventChannel: BroadcastChannel | null = null;
let httpFetchCallback: HttpFetchCallback | null = null;

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

export function ensureHttpFetchEventChannel() {
  if (httpFetchEventChannel) {
    return;
  }

  httpFetchEventChannel = new BroadcastChannel(httpFetchEventChannelName);
  httpFetchEventChannel.onmessage = (message) => {
    const event = parseHttpFetchEvent(message.data);
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
  };
}

export const setHttpFetchCallback = (
  callback: HttpFetchCallback | null,
): void => {
  httpFetchCallback = callback;
  ensureHttpFetchEventChannel();
};
