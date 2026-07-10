import { fetch } from "undici";
import * as cheerio from "cheerio";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const CONTENT_SELECTORS = [
  "#chr-content",
  ".chr-content",
  "#chapter-content",
  ".chapter-content",
  ".reading-content",
  ".text-left",
  "#content",
  ".content",
  "article",
  ".entry-content",
  "#novel-content",
  ".novel-content",
];

const CHAPTER_PATTERNS = [/chapter[-_]?\d+/i, /ch[-_]?\d+/i, /\/\d+\/?$/];

export function sanitizeFilename(name) {
  return (name || "novel").replace(/[<>:"/\\|?*]/g, "").trim() || "novel";
}

export function getParserForUrl(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  for (const parser of PARSERS) {
    if (parser.domains.some((d) => host === d || host.endsWith("." + d))) {
      return parser;
    }
  }
  return genericParser;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function cleanContent($, node) {
  const clone = $(node).clone();
  clone.find("script, style, iframe, ins, noscript").remove();
  clone.find("[class*='ads'], [class*='advert'], [class*='banner']").remove();

  const paragraphs = [];
  clone.find("p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  });

  if (paragraphs.length) return paragraphs.join("\n\n");

  return clone
    .text()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n\n");
}

function extractContent($) {
  for (const sel of CONTENT_SELECTORS) {
    const node = $(sel).first();
    if (node.length) return cleanContent($, node);
  }
  $("script, style, nav, header, footer, aside").remove();
  const main = $("main").first().length ? $("main").first() : $("body");
  return cleanContent($, main);
}

const genericParser = {
  name: "generic",
  domains: [],
  async getNovelInfo(url) {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    let title = $("h1").first().text().trim();
    if (!title) {
      const path = new URL(url).pathname.replace(/-/g, " ").replace(/\//g, " ").trim();
      title = path || "Untitled Novel";
    }

    let author = $(".author, a[href*='author']").first().text().trim().replace(/^Author:\s*/i, "");
    if (!author) author = "Unknown";

    const chapters = extractChapters($, url);
    if (!chapters.length) {
      chapters.push({ number: 1, title: "Chapter 1", url });
    }

    return { title, author, source_url: url, chapters };
  },
  async fetchChapter(chapter) {
    const html = await fetchHtml(chapter.url);
    const $ = cheerio.load(html);
    return extractContent($);
  },
};

function extractChapters($, baseUrl) {
  const seen = new Set();
  const links = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    const text = $(el).text().trim();
    if (!href || !text || text.length > 200) return;

    const full = absoluteUrl(baseUrl, href);
    if (seen.has(full)) return;

    const matches = CHAPTER_PATTERNS.some((p) => p.test(href) || p.test(text));
    if (matches) {
      seen.add(full);
      links.push({ title: text, url: full });
    }
  });

  if (links.length < 3) {
    $("#list-chapter a, .list-chapter a, #chapter-list a, ul.index a").each((_, el) => {
      const href = $(el).attr("href")?.trim();
      const text = $(el).text().trim();
      if (!href || !text) return;
      const full = absoluteUrl(baseUrl, href);
      if (!seen.has(full)) {
        seen.add(full);
        links.push({ title: text, url: full });
      }
    });
  }

  return links.map((l, i) => ({ number: i + 1, title: l.title, url: l.url, content: "" }));
}

const novelFullParser = {
  name: "novelfull",
  domains: [
    "novelfull.com",
    "novelfull.net",
    "readnovelfull.com",
    "novelbin.com",
    "novelbin.me",
    "novelbin.net",
    "lightnovelworld.com",
    "readlightnovel.org",
  ],
  async getNovelInfo(url) {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h3.title, .desc h3.title, h1").first().text().trim() || "Untitled";
    const author = $("a[href*='author'], .info a[href*='author']").first().text().trim() || "Unknown";

    const chapters = [];
    $("#list-chapter a, .list-chapter a, ul.index a").each((i, el) => {
      const href = $(el).attr("href")?.trim();
      if (!href) return;
      chapters.push({
        number: chapters.length + 1,
        title: $(el).text().trim() || `Chapter ${chapters.length + 1}`,
        url: absoluteUrl(url, href),
        content: "",
      });
    });

    return { title, author, source_url: url, chapters };
  },
  async fetchChapter(chapter) {
    const html = await fetchHtml(chapter.url);
    const $ = cheerio.load(html);
    const content = $("#chr-content, .chr-content, #chapter-content").first();
    if (!content.length) return "";
    content.find("script, style, ins, iframe, [class*='ads']").remove();
    const paragraphs = [];
    content.find("p").each((_, el) => {
      const t = $(el).text().trim();
      if (t) paragraphs.push(t);
    });
    return paragraphs.join("\n\n");
  },
};

const royalRoadParser = {
  name: "royalroad",
  domains: ["royalroad.com"],
  async getNovelInfo(url) {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h1.font-white, .fiction-info h1").first().text().trim() || "Untitled";
    const author = $("h4.font-white a, .author a").first().text().trim() || "Unknown";

    const chapters = [];
    $("table#chapters tbody tr").each((_, row) => {
      const link = $(row).find("a").first();
      const href = link.attr("href");
      if (!href) return;
      chapters.push({
        number: chapters.length + 1,
        title: link.text().trim() || `Chapter ${chapters.length + 1}`,
        url: absoluteUrl(url, href),
        content: "",
      });
    });

    return { title, author, source_url: url, chapters };
  },
  async fetchChapter(chapter) {
    const html = await fetchHtml(chapter.url);
    const $ = cheerio.load(html);
    const content = $(".chapter-content, div.portlet-body").first();
    if (!content.length) return "";
    const paragraphs = [];
    content.find("p").each((_, el) => {
      const t = $(el).text().trim();
      if (t) paragraphs.push(t);
    });
    return paragraphs.join("\n\n");
  },
};

const webNovelParser = {
  name: "webnovel",
  domains: ["webnovel.com"],
  async getNovelInfo(url) {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h1.g_db, .det-hd h1, h1").first().text().trim() || "Untitled";
    const author = $(".author .name, a[href*='author']").first().text().trim() || "Unknown";

    const chapters = [];
    $("a.ell, .volume-item a, .chapter-item a").each((_, el) => {
      const href = $(el).attr("href")?.trim();
      if (!href || !/chapter/i.test(href)) return;
      chapters.push({
        number: chapters.length + 1,
        title: $(el).text().trim() || `Chapter ${chapters.length + 1}`,
        url: absoluteUrl(url, href),
        content: "",
      });
    });

    return { title, author, source_url: url, chapters };
  },
  async fetchChapter(chapter) {
    const html = await fetchHtml(chapter.url);
    const $ = cheerio.load(html);
    const content = $(".cha-words, .chapter_content, .cha-content").first();
    if (!content.length) {
      const match = html.match(/"chapterContent"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (match) {
        return JSON.parse(`"${match[1]}"`).replace(/\\n/g, "\n\n");
      }
      return "";
    }
    const paragraphs = [];
    content.find("p").each((_, el) => {
      const t = $(el).text().trim();
      if (t) paragraphs.push(t);
    });
    return paragraphs.join("\n\n");
  },
};

const PARSERS = [royalRoadParser, novelFullParser, webNovelParser, genericParser];

export class ScrapeEngine {
  constructor(concurrency = 15) {
    this.concurrency = Math.max(1, Math.min(concurrency, 50));
  }

  async scrapeNovel(url, onProgress, chapterLimit) {
    const parser = getParserForUrl(url);
    const limit = (await import("p-limit")).default(this.concurrency);

    try {
      const novel = await parser.getNovelInfo(url);
      if (chapterLimit) novel.chapters = novel.chapters.slice(0, chapterLimit);

      const total = novel.chapters.length;
      let completed = 0;

      const progress = {
        novel_title: novel.title,
        total_chapters: total,
        completed_chapters: 0,
        current_chapter: "",
        status: "downloading",
      };

      if (onProgress) onProgress(progress);

      await Promise.all(
        novel.chapters.map((chapter) =>
          limit(async () => {
            progress.current_chapter = chapter.title;
            if (onProgress) onProgress({ ...progress });

            try {
              chapter.content = await parser.fetchChapter(chapter);
            } catch (err) {
              chapter.content = `[Error fetching chapter: ${err.message}]`;
            }

            completed++;
            progress.completed_chapters = completed;
            if (onProgress) onProgress({ ...progress });
          })
        )
      );

      progress.status = "completed";
      if (onProgress) onProgress(progress);

      return { novel, success: true };
    } catch (err) {
      return {
        novel: { title: "Error", source_url: url, chapters: [] },
        success: false,
        error: err.message,
      };
    }
  }
}

export function exportNovelTxt(novel) {
  const lines = [
    novel.title,
    `Author: ${novel.author}`,
    `Source: ${novel.source_url}`,
    "",
    "=".repeat(60),
    "",
  ];

  for (const ch of novel.chapters) {
    lines.push(`Chapter ${ch.number}: ${ch.title}`);
    lines.push("-".repeat(40));
    lines.push(ch.content || "[No content]");
    lines.push("");
    lines.push("");
  }

  return lines.join("\n");
}

export function exportNovelJson(novel) {
  return JSON.stringify(novel, null, 2);
}

export function exportNovel(novel, format = "txt") {
  if (format === "json") return exportNovelJson(novel);
  return exportNovelTxt(novel);
}
