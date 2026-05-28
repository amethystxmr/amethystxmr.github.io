import { useEffect, useState } from "react";

const CACHE_KEY = "xmr_price_eur";
export const XMR_PRICE_REFRESH_REQUESTED_EVENT = "xmr-price-refresh-requested";
export const XMR_PRICE_CACHE_UPDATED_EVENT = "xmr-price-cache-updated";

type XmrPriceCacheEntry = {
  price: number;
  source: string;
  fetchedAt: number;
};

export function refreshXmrPrice() {
  try {
    localStorage.removeItem(CACHE_KEY);
    window.dispatchEvent(new Event(XMR_PRICE_REFRESH_REQUESTED_EVENT));
  } catch (error) {
    console.error("Failed to refresh XMR price:", error);
  }
}

function getCached(): XmrPriceCacheEntry | null {
  const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<XmrPriceCacheEntry> & {
        timestamp?: number;
      };
      const fetchedAt = parsed.fetchedAt ?? parsed.timestamp;
      if (
        typeof parsed.price === "number" &&
        typeof fetchedAt === "number" &&
        Date.now() - fetchedAt < CACHE_TTL
      ) {
        const source =
          typeof parsed.source === "string" ? parsed.source : "Unknown source";
        console.log("Using cached XMR price:", parsed.price);
        return {
          price: parsed.price,
          source,
          fetchedAt,
        };
      } else {
        console.log("Cache expired");
      }
    }
    return null;
  } catch (error) {
    console.error("Failed to read cache:", error);
    return null;
  }
}

function setCache(newPrice: number, source: string): XmrPriceCacheEntry {
  const next: XmrPriceCacheEntry = {
    price: newPrice,
    source,
    fetchedAt: Date.now(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(XMR_PRICE_CACHE_UPDATED_EVENT));
  return next;
}

export function getCachedXmrPrice(): XmrPriceCacheEntry | null {
  return getCached();
}

async function fetchPriceCoinGecko() {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=eur",
  );
  const data = await response.json();
  const newPrice = data.monero.eur;
  if (typeof newPrice !== "number") {
    throw new Error("Invalid price data");
  }
  console.log("Fetched price from CoinGecko:", newPrice);
  return newPrice;
}

async function fetchPriceCryptoCompare() {
  const response = await fetch(
    "https://min-api.cryptocompare.com/data/price?fsym=XMR&tsyms=EUR",
  );
  const data = await response.json();
  const newPrice = data.EUR;
  if (typeof newPrice !== "number") {
    throw new Error("Invalid price data");
  }
  console.log("Fetched price from CryptoCompare:", newPrice);
  return newPrice;
}

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function useXmrPrice() {
  const [priceInfo, setPriceInfo] = useState<XmrPriceCacheEntry | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    const onRefreshRequested = () => {
      setPriceInfo(null);
      setReloadCounter((x) => x + 1);
    };
    window.addEventListener(
      XMR_PRICE_REFRESH_REQUESTED_EVENT,
      onRefreshRequested,
    );
    return () =>
      window.removeEventListener(
        XMR_PRICE_REFRESH_REQUESTED_EVENT,
        onRefreshRequested,
      );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const shouldUseCache = reloadCounter === 0;
    if (shouldUseCache) {
      const cachedPrice = getCached();
      if (cachedPrice !== null) {
        setPriceInfo(cachedPrice);
        return;
      }
    }

    const fetchers = shuffleArray([
      { fetcher: fetchPriceCoinGecko, source: "CoinGecko" },
      { fetcher: fetchPriceCryptoCompare, source: "CryptoCompare" },
    ]);
    (async () => {
      for (const { fetcher, source } of fetchers) {
        try {
          const newPrice = await fetcher();
          if (!cancelled && newPrice !== undefined) {
            const cached = setCache(newPrice, source);
            setPriceInfo(cached);
            return; // Stop after the first successful fetch
          }
        } catch (error) {
          console.error(
            "Failed to fetch price from one of the sources:",
            error,
          );
        }
      }
      console.error("All price fetchers failed");
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadCounter]);

  return priceInfo;
}
