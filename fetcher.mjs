import { fetch } from "undici";
import { gotScraping } from "got-scraping";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Referer: "https://www.google.com/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const CLOUDFLARE_DOMAINS = [
  "freewebnovel.com",
  "novelbin.com",
  "novelbin.me",
  "novelbin.net",
  "novelfull.com",
  "novelfull.net",
];

const RATE_LIMIT_MS = 350;
const lastRequestByHost = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostNeedsScraping(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return CLOUDFLARE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

async function throttle(url) {
  if (!hostNeedsScraping(url)) return;
  const host = new URL(url).hostname;
  const last = lastRequestByHost.get(host) || 0;
  const wait = RATE_LIMIT_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastRequestByHost.set(host, Date.now());
}

function isCloudflareChallenge(html) {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenge-platform")
  );
}

async function fetchWithScraping(url, headers, maxRetries = 6) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await throttle(url);

    const response = await gotScraping({
      url,
      headers,
      timeout: { request: 60000 },
      throwHttpErrors: false,
      retry: { limit: 0 },
    });

    if (response.statusCode === 429 || response.statusCode === 503) {
      const wait = Math.min(60000, 3000 * Math.pow(2, attempt));
      await sleep(wait);
      continue;
    }

    if (response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode} for ${url}`);
    }

    return response.body;
  }

  throw new Error(`HTTP 429 (rate limited) for ${url} — try again later or lower --speed`);
}

export async function fetchHtml(url, extraHeaders = {}) {
  const headers = { ...BROWSER_HEADERS, ...extraHeaders };
  const useScraping = hostNeedsScraping(url);

  if (useScraping) {
    return fetchWithScraping(url, headers);
  }

  await throttle(url);
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      return fetchWithScraping(url, headers);
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  if (isCloudflareChallenge(html)) {
    return fetchWithScraping(url, headers);
  }

  return html;
}

export async function fetchJson(url, extraHeaders = {}) {
  const html = await fetchHtml(url, {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    ...extraHeaders,
  });
  return JSON.parse(html);
}
