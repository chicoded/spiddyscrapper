import { fetch } from "undici";
import { gotScraping } from "got-scraping";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const CLOUDFLARE_DOMAINS = new Set([
  "freewebnovel.com",
  "novelbin.com",
  "novelbin.me",
  "novelbin.net",
  "novelfull.com",
  "novelfull.net",
]);

const scrapingClient = gotScraping.extend({
  timeout: { request: 30000, connect: 10000 },
  decompress: true,
  throwHttpErrors: false,
  retry: { limit: 0 },
});

const hostStats = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostNeedsScraping(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return CLOUDFLARE_DOMAINS.has(host);
}

function getHostStats(host) {
  if (!hostStats.has(host)) {
    hostStats.set(host, { inflight: 0, backoffMs: 0, last429: 0 });
  }
  return hostStats.get(host);
}

async function acquireSlot(url, maxInflight = globalMaxInflight) {
  const host = new URL(url).hostname;
  const stats = getHostStats(host);

  while (stats.inflight >= maxInflight) {
    await sleep(25);
  }

  if (stats.backoffMs > 0) {
    const since429 = Date.now() - stats.last429;
    if (since429 < stats.backoffMs) {
      await sleep(stats.backoffMs - since429);
    }
  }

  stats.inflight++;
}

function releaseSlot(url, ok) {
  const host = new URL(url).hostname;
  const stats = getHostStats(host);
  stats.inflight = Math.max(0, stats.inflight - 1);

  if (ok) {
    stats.backoffMs = Math.max(0, stats.backoffMs - 50);
  }
}

function markRateLimited(url) {
  const host = new URL(url).hostname;
  const stats = getHostStats(host);
  stats.last429 = Date.now();
  stats.backoffMs = Math.min(8000, Math.max(500, (stats.backoffMs || 250) * 1.5));
}

function isCloudflareChallenge(html) {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenge-platform")
  );
}

async function fetchWithScraping(url, headers, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await acquireSlot(url);
    try {
      const response = await scrapingClient(url, { headers });

      if (response.statusCode === 429 || response.statusCode === 503) {
        markRateLimited(url);
        const wait = Math.min(15000, 1000 * Math.pow(1.8, attempt));
        await sleep(wait);
        continue;
      }

      if (response.statusCode >= 400) {
        throw new Error(`HTTP ${response.statusCode} for ${url}`);
      }

      releaseSlot(url, true);
      return response.body;
    } catch (err) {
      releaseSlot(url, false);
      if (attempt === maxRetries - 1) throw err;
      await sleep(500 * (attempt + 1));
    }
  }

  throw new Error(`HTTP 429 (rate limited) for ${url}`);
}

export async function fetchHtml(url, extraHeaders = {}) {
  const headers = { ...BROWSER_HEADERS, ...extraHeaders };
  const useScraping = hostNeedsScraping(url);

  if (useScraping) {
    return fetchWithScraping(url, headers);
  }

  await acquireSlot(url);
  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        releaseSlot(url, false);
        return fetchWithScraping(url, headers);
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    const html = await res.text();
    if (isCloudflareChallenge(html)) {
      releaseSlot(url, false);
      return fetchWithScraping(url, headers);
    }

    releaseSlot(url, true);
    return html;
  } catch (err) {
    releaseSlot(url, false);
    throw err;
  }
}

export async function fetchJson(url, extraHeaders = {}) {
  const html = await fetchHtml(url, {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: extraHeaders.Referer || new URL(url).origin,
    ...extraHeaders,
  });
  return JSON.parse(html);
}

let globalMaxInflight = 40;

export function configureFetcher({ maxInflight = 40 } = {}) {
  globalMaxInflight = maxInflight;
}
