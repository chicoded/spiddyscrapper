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
