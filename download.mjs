import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ScrapeEngine, exportNovel, sanitizeFilename, getParserForUrl } from "./scraper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.join(__dirname, "downloads");

function printHelp() {
  console.log(`
SpiddyScapper — Download full novels to your PC

Usage:
  node download.mjs <url> [url2] [url3...]
  node download.mjs --file urls.txt

Options:
  --output, -o   Folder to save books (default: ./downloads)
  --format, -f   txt or json (default: txt)
  --speed, -s    Parallel downloads 1-50 (default: 12, lower if rate limited)
  --limit, -l    Only download first N chapters (for testing)
  --file         Text file with one URL per line
  --help, -h     Show this help

Examples:
  node download.mjs "https://freewebnovel.com/novel/infinite-mana-in-the-apocalypse"
  node download.mjs -o "C:\\Users\\HP\\Books" -s 25 "https://www.royalroad.com/fiction/21220/mother-of-learning"
`);
}

function parseArgs(argv) {
  const options = {
    urls: [],
    output: DEFAULT_OUTPUT,
    format: "txt",
    concurrency: 12,
    file: null,
    chapterLimit: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--output" || arg === "-o") {
      options.output = path.resolve(argv[++i]);
    } else if (arg === "--format" || arg === "-f") {
      options.format = argv[++i];
    } else if (arg === "--speed" || arg === "-s") {
      options.concurrency = parseInt(argv[++i], 10);
    } else if (arg === "--limit" || arg === "-l") {
      options.chapterLimit = parseInt(argv[++i], 10);
    } else if (arg === "--file") {
      options.file = argv[++i];
    } else if (!arg.startsWith("-")) {
      options.urls.push(arg);
    }
  }

  return options;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "?";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function drawProgress(label, completed, total, startedAt) {
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const barLen = 30;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = completed > 0 ? elapsed / completed : 0;
  const eta = formatEta((total - completed) * rate);
  process.stdout.write(`\r${label} [${bar}] ${completed}/${total} (${pct}%) ETA ${eta}   `);
}

async function loadUrlsFromFile(filepath) {
  const text = await fs.readFile(filepath, "utf-8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function downloadNovel(url, options) {
  const engine = new ScrapeEngine(options.concurrency);
  const parserName = getParserForUrl(url).name;
  const startedAt = Date.now();

  console.log(`\n📖 ${url}`);
  console.log(`   Parser: ${parserName} | Saving to: ${options.output}`);

  let lastLog = 0;
  const result = await engine.scrapeNovel(url, (progress) => {
    const now = Date.now();
    if (now - lastLog < 200 && progress.status !== "completed") return;
    lastLog = now;

    if (progress.total_chapters === 0) {
      process.stdout.write(`\r   Fetching chapter list...`);
      return;
    }

    drawProgress("   Downloading", progress.completed_chapters, progress.total_chapters, startedAt);
  }, options.chapterLimit);

  process.stdout.write("\n");

  if (!result.success) {
    console.error(`   ❌ Failed: ${result.error}`);
    return null;
  }

  await fs.mkdir(options.output, { recursive: true });
  const ext = options.format === "json" ? "json" : "txt";
  const filename = `${sanitizeFilename(result.novel.title)}.${ext}`;
  const filepath = path.join(options.output, filename);

  await fs.writeFile(filepath, exportNovel(result.novel, options.format), "utf-8");

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Saved: ${filepath}`);
  console.log(`   ${result.novel.chapters.length} chapters in ${elapsed} min`);

  return filepath;
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.help || (options.urls.length === 0 && !options.file)) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  if (options.file) {
    const fromFile = await loadUrlsFromFile(options.file);
    options.urls.push(...fromFile);
  }

  if (options.urls.length === 0) {
    console.error("No URLs provided.");
    process.exit(1);
  }

  console.log("🕷️  SpiddyScapper — Local full book download");
  console.log(`   Books folder: ${options.output}`);
  console.log(`   Parallel speed: ${options.concurrency}`);

  const saved = [];
  for (const url of options.urls) {
    const filepath = await downloadNovel(url, options);
    if (filepath) saved.push(filepath);
  }

  console.log(`\nDone! ${saved.length} book(s) saved locally.`);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
