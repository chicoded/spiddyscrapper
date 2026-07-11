# SpiddyScapper

Fast webnovel scraper with a web UI. Paste multiple novel links and download chapters in parallel.

## Features

- **Multi-link support** — scrape several novels at once
- **Blazing fast** — up to 50 parallel chapter downloads (default: 20)
- **Live progress** — real-time progress bar per novel
- **Multiple formats** — export as TXT, EPUB, or JSON
- **Site parsers** for Royal Road, NovelFull, NovelBin, WebNovel, and a generic fallback

## Quick Start

### Node.js (recommended)

```bash
npm install
npm start
```

### Python (alternative)

```bash
pip install -r requirements.txt
python main.py
```

Open **http://localhost:8000** in your browser.

## Download full books locally (recommended)

For complete novels (thousands of chapters), use the **local downloader** — files save to your PC in the `downloads` folder.

```bash
npm install

# Download one full book
npm run download -- "https://freewebnovel.com/novel/infinite-mana-in-the-apocalypse"

# Save to a custom folder
npm run download -- -o "C:\Users\HP\Books" -s 25 "https://freewebnovel.com/novel/your-novel"

# Multiple books at once
npm run download -- "url1" "url2" "url3"
```

Options:
- `-o` / `--output` — folder on your PC (default: `./downloads`)
- `-s` / `--speed` — parallel chapter downloads, 1–50 (default: 35)
- `-f` / `--format` — `txt` or `json`

Large novels (5000+ chapters) take about **15–30 minutes** locally at default speed. Keep the terminal open until it finishes.

**Do not use Vercel for full books** — it has a 60 second timeout. Use local download instead.

## Deploy

### Vercel (fixes 404)

1. Import [chicoded/spiddyscrapper](https://github.com/chicoded/spiddyscrapper) on [vercel.com](https://vercel.com)
2. Deploy — `vercel.json` routes all requests to the Express API
3. Note: Vercel has a **60s timeout** — use a chapter limit for long novels

### Render (recommended for full scraping)

1. Go to [render.com](https://render.com) → New → Blueprint
2. Connect the GitHub repo — uses `render.yaml` automatically
3. No timeout limits — best for downloading full novels

## Usage

1. Paste one or more novel URLs (one per line)
2. Adjust speed slider (higher = faster, but be respectful to servers)
3. Optionally set a chapter limit for testing
4. Choose export format (TXT, EPUB, or JSON)
5. Click **Start Download**
6. Download files when complete

## Supported Sites

| Site | Example |
|------|---------|
| FreeWebNovel | freewebnovel.com |
| Royal Road | royalroad.com |
| NovelFull | novelfull.com, novelfull.net |
| NovelBin | novelbin.com, novelbin.me |
| Light Novel World | lightnovelworld.com |
| WebNovel | webnovel.com |
| Other sites | Generic parser (best-effort) |

## API

```bash
# Start a scrape job
curl -X POST http://localhost:8000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.royalroad.com/fiction/..."], "concurrency": 20, "format": "txt"}'

# Sync scrape (waits for completion)
curl -X POST http://localhost:8000/api/scrape/sync \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://..."], "concurrency": 15}'
```

## Notes

- Use responsibly and respect website terms of service
- Some sites may block aggressive scraping — lower concurrency if you get errors
- Downloads are saved to the `downloads/` folder
