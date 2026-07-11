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

function hostNeedsScraping(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return CLOUDFLARE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

function isCloudflareChallenge(html) {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenge-platform")
  );
}

export async function fetchHtml(url, extraHeaders = {}) {
  const headers = { ...BROWSER_HEADERS, ...extraHeaders };
  const useScraping = hostNeedsScraping(url);

  if (useScraping) {
    const response = await gotScraping({
      url,
      headers,
      timeout: { request: 45000 },
      retry: { limit: 2 },
    });
    if (response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode} for ${url}`);
    }
    return response.body;
  }

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    if (res.status === 403) {
      const body = await gotScraping({
        url,
        headers,
        timeout: { request: 45000 },
        retry: { limit: 2 },
      });
      if (body.statusCode >= 400) {
        throw new Error(`HTTP ${body.statusCode} for ${url}`);
      }
      return body.body;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  if (isCloudflareChallenge(html)) {
    const response = await gotScraping({
      url,
      headers,
      timeout: { request: 45000 },
      retry: { limit: 2 },
    });
    return response.body;
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
