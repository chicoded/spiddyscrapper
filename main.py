from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from scraper.engine import ScrapeEngine, sanitize_filename
from scraper.exporter import export_novel
from scraper.parsers.base import NovelInfo, Chapter

APP_DIR = Path(__file__).parent
STATIC_DIR = APP_DIR / "static"
DOWNLOADS_DIR = APP_DIR / "downloads"

app = FastAPI(title="SpiddyScapper", description="Fast webnovel scraper")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

jobs: dict[str, dict] = {}


class ScrapeRequest(BaseModel):
    urls: list[str] = Field(..., min_length=1, description="Novel URLs to scrape")
    concurrency: int = Field(default=15, ge=1, le=50)
    chapter_limit: Optional[int] = Field(default=None, ge=1)
    format: str = Field(default="txt", pattern="^(txt|json|epub)$")


class NovelResponse(BaseModel):
    job_id: str
    message: str


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok", "name": "SpiddyScapper"}


@app.post("/api/scrape", response_model=NovelResponse)
async def start_scrape(request: ScrapeRequest):
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {"status": "running", "results": [], "progress": []}

    asyncio.create_task(_run_scrape_job(job_id, request))
    return NovelResponse(job_id=job_id, message=f"Scraping {len(request.urls)} novel(s)")


@app.get("/api/scrape/{job_id}/stream")
async def stream_progress(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        last_len = 0
        while True:
            job = jobs.get(job_id)
            if not job:
                break

            progress = job.get("progress", [])
            if len(progress) > last_len:
                for item in progress[last_len:]:
                    yield f"data: {json.dumps(item)}\n\n"
                last_len = len(progress)

            if job.get("status") in ("completed", "failed"):
                yield f"data: {json.dumps({'type': 'done', 'status': job['status'], 'results': job.get('results', [])})}\n\n"
                break

            await asyncio.sleep(0.3)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/scrape/{job_id}/status")
async def job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/api/download/{job_id}/{filename}")
async def download_file(job_id: str, filename: str):
    filepath = DOWNLOADS_DIR / job_id / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    media_types = {"txt": "text/plain", "json": "application/json", "epub": "application/epub+zip"}
    ext = filename.rsplit(".", 1)[-1]
    return FileResponse(filepath, filename=filename, media_type=media_types.get(ext, "application/octet-stream"))


@app.post("/api/scrape/sync")
async def scrape_sync(request: ScrapeRequest):
    engine = ScrapeEngine(concurrency=request.concurrency)
    results = await engine.scrape_multiple(request.urls, chapter_limit=request.chapter_limit)

    job_id = str(uuid.uuid4())[:8]
    output_dir = DOWNLOADS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    files = []
    for result in results:
        if result.success:
            path = export_novel(result.novel, output_dir, request.format)
            files.append({"title": result.novel.title, "filename": path.name, "chapters": len(result.novel.chapters)})
        else:
            files.append({"title": "Error", "error": result.error, "url": result.novel.source_url})

    return {"job_id": job_id, "files": files}


async def _run_scrape_job(job_id: str, request: ScrapeRequest) -> None:
    engine = ScrapeEngine(concurrency=request.concurrency)
    output_dir = DOWNLOADS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        for url in request.urls:
            url = url.strip()
            if not url:
                continue

            def on_progress(p):
                jobs[job_id]["progress"].append({
                    "type": "progress",
                    "url": url,
                    "title": p.novel_title,
                    "completed": p.completed_chapters,
                    "total": p.total_chapters,
                    "current": p.current_chapter,
                    "status": p.status,
                })

            result = await engine.scrape_novel(url, on_progress=on_progress, chapter_limit=request.chapter_limit)

            if result.success:
                path = export_novel(result.novel, output_dir, request.format)
                jobs[job_id]["results"].append({
                    "title": result.novel.title,
                    "author": result.novel.author,
                    "chapters": len(result.novel.chapters),
                    "filename": path.name,
                    "url": url,
                })
            else:
                jobs[job_id]["results"].append({
                    "title": "Error",
                    "error": result.error,
                    "url": url,
                })

        jobs[job_id]["status"] = "completed"
    except Exception as exc:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(exc)


if __name__ == "__main__":
    import uvicorn

    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
