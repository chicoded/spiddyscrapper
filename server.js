import express from "express";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ScrapeEngine, exportNovel, sanitizeFilename } from "./scraper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "static");
const DOWNLOADS_DIR = path.join(__dirname, "downloads");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/static", express.static(STATIC_DIR));

const jobs = new Map();

app.get("/", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", name: "SpiddyScapper" });
});

app.post("/api/scrape", (req, res) => {
  const { urls, concurrency = 15, chapter_limit, format = "txt" } = req.body;

  if (!urls?.length) {
    return res.status(400).json({ error: "At least one URL required" });
  }

  const jobId = uuidv4().slice(0, 8);
  jobs.set(jobId, { status: "running", results: [], progress: [] });

  runScrapeJob(jobId, { urls, concurrency, chapter_limit, format });
  res.json({ job_id: jobId, message: `Scraping ${urls.length} novel(s)` });
});

app.get("/api/scrape/:jobId/stream", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let lastLen = 0;
  const interval = setInterval(() => {
    const current = jobs.get(req.params.jobId);
    if (!current) {
      clearInterval(interval);
      res.end();
      return;
    }

    const progress = current.progress || [];
    for (let i = lastLen; i < progress.length; i++) {
      res.write(`data: ${JSON.stringify(progress[i])}\n\n`);
    }
    lastLen = progress.length;

    if (current.status === "completed" || current.status === "failed") {
      res.write(
        `data: ${JSON.stringify({ type: "done", status: current.status, results: current.results })}\n\n`
      );
      clearInterval(interval);
      res.end();
    }
  }, 300);

  req.on("close", () => clearInterval(interval));
});

app.get("/api/scrape/:jobId/status", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/download/:jobId/:filename", async (req, res) => {
  const filepath = path.join(DOWNLOADS_DIR, req.params.jobId, req.params.filename);
  try {
    await fs.access(filepath);
    res.download(filepath);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

app.post("/api/scrape/sync", async (req, res) => {
  const { urls, concurrency = 15, chapter_limit, format = "txt" } = req.body;
  const engine = new ScrapeEngine(concurrency);
  const jobId = uuidv4().slice(0, 8);
  const outputDir = path.join(DOWNLOADS_DIR, jobId);
  await fs.mkdir(outputDir, { recursive: true });

  const files = [];
  for (const url of urls) {
    const result = await engine.scrapeNovel(url.trim(), null, chapter_limit);
    if (result.success) {
      const filename = `${sanitizeFilename(result.novel.title)}.${format === "json" ? "json" : "txt"}`;
      await fs.writeFile(path.join(outputDir, filename), exportNovel(result.novel, format), "utf-8");
      files.push({
        title: result.novel.title,
        filename,
        chapters: result.novel.chapters.length,
      });
    } else {
      files.push({ title: "Error", error: result.error, url });
    }
  }

  res.json({ job_id: jobId, files });
});

async function runScrapeJob(jobId, { urls, concurrency, chapter_limit, format }) {
  const engine = new ScrapeEngine(concurrency);
  const outputDir = path.join(DOWNLOADS_DIR, jobId);
  await fs.mkdir(outputDir, { recursive: true });
  const job = jobs.get(jobId);

  try {
    for (const rawUrl of urls) {
      const url = rawUrl.trim();
      if (!url) continue;

      const onProgress = (p) => {
        job.progress.push({
          type: "progress",
          url,
          title: p.novel_title,
          completed: p.completed_chapters,
          total: p.total_chapters,
          current: p.current_chapter,
          status: p.status,
        });
      };

      const result = await engine.scrapeNovel(url, onProgress, chapter_limit);

      if (result.success) {
        const ext = format === "json" ? "json" : "txt";
        const filename = `${sanitizeFilename(result.novel.title)}.${ext}`;
        await fs.writeFile(path.join(outputDir, filename), exportNovel(result.novel, format), "utf-8");
        job.results.push({
          title: result.novel.title,
          author: result.novel.author,
          chapters: result.novel.chapters.length,
          filename,
          url,
        });
      } else {
        job.results.push({ title: "Error", error: result.error, url });
      }
    }

    job.status = "completed";
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
  }
}

const PORT = process.env.PORT || 8000;

await fs.mkdir(DOWNLOADS_DIR, { recursive: true });

app.listen(PORT, () => {
  console.log(`SpiddyScapper running at http://localhost:${PORT}`);
});
