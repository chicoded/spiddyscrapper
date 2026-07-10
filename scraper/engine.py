from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Optional

import httpx

from .parsers import get_parser_for_url
from .parsers.base import Chapter, NovelInfo


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass
class ScrapeProgress:
    novel_title: str
    total_chapters: int
    completed_chapters: int
    current_chapter: str = ""
    status: str = "pending"
    error: Optional[str] = None


@dataclass
class ScrapeResult:
    novel: NovelInfo
    success: bool
    error: Optional[str] = None


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", name)
    return cleaned.strip() or "novel"


class ScrapeEngine:
    def __init__(self, concurrency: int = 15, timeout: float = 30.0):
        self.concurrency = max(1, min(concurrency, 50))
        self.timeout = timeout
        self._semaphore: Optional[asyncio.Semaphore] = None

    async def scrape_novel(
        self,
        url: str,
        on_progress: Optional[Callable[[ScrapeProgress], None]] = None,
        chapter_limit: Optional[int] = None,
    ) -> ScrapeResult:
        parser = get_parser_for_url(url)
        limits = httpx.Limits(max_connections=self.concurrency + 5, max_keepalive_connections=self.concurrency)
        self._semaphore = asyncio.Semaphore(self.concurrency)

        async with httpx.AsyncClient(
            headers=DEFAULT_HEADERS,
            timeout=self.timeout,
            limits=limits,
        ) as client:
            try:
                novel = await parser.get_novel_info(url, client)
                if chapter_limit:
                    novel.chapters = novel.chapters[:chapter_limit]

                total = len(novel.chapters)
                progress = ScrapeProgress(
                    novel_title=novel.title,
                    total_chapters=total,
                    completed_chapters=0,
                    status="downloading",
                )
                if on_progress:
                    on_progress(progress)

                tasks = [
                    self._fetch_chapter(parser, chapter, client, novel.title, progress, on_progress)
                    for chapter in novel.chapters
                ]
                await asyncio.gather(*tasks)

                progress.status = "completed"
                if on_progress:
                    on_progress(progress)

                return ScrapeResult(novel=novel, success=True)
            except Exception as exc:
                return ScrapeResult(
                    novel=NovelInfo(title="Error", source_url=url),
                    success=False,
                    error=str(exc),
                )

    async def scrape_multiple(
        self,
        urls: list[str],
        on_progress: Optional[Callable[[str, ScrapeProgress], None]] = None,
        chapter_limit: Optional[int] = None,
    ) -> list[ScrapeResult]:
        results: list[ScrapeResult] = []

        async def scrape_one(url: str) -> ScrapeResult:
            def progress_cb(p: ScrapeProgress) -> None:
                if on_progress:
                    on_progress(url, p)

            return await self.scrape_novel(url, on_progress=progress_cb, chapter_limit=chapter_limit)

        novel_tasks = [scrape_one(url.strip()) for url in urls if url.strip()]
        results = await asyncio.gather(*novel_tasks)
        return list(results)

    async def _fetch_chapter(
        self,
        parser,
        chapter: Chapter,
        client: httpx.AsyncClient,
        novel_title: str,
        progress: ScrapeProgress,
        on_progress: Optional[Callable[[ScrapeProgress], None]],
    ) -> None:
        assert self._semaphore is not None
        async with self._semaphore:
            progress.current_chapter = chapter.title
            if on_progress:
                on_progress(progress)
            try:
                chapter.content = await parser.fetch_chapter(chapter, client)
            except Exception as exc:
                chapter.content = f"[Error fetching chapter: {exc}]"
            finally:
                progress.completed_chapters += 1
                if on_progress:
                    on_progress(progress)

    async def stream_scrape(
        self,
        urls: list[str],
        chapter_limit: Optional[int] = None,
    ) -> AsyncIterator[dict]:
        engine = self

        for url in urls:
            url = url.strip()
            if not url:
                continue

            parser_name = get_parser_for_url(url).name
            yield {"type": "novel_start", "url": url, "parser": parser_name}

            progress_state = {"completed": 0, "total": 0, "title": ""}

            def on_progress(p: ScrapeProgress) -> None:
                progress_state["completed"] = p.completed_chapters
                progress_state["total"] = p.total_chapters
                progress_state["title"] = p.novel_title

            result = await engine.scrape_novel(url, on_progress=on_progress, chapter_limit=chapter_limit)

            if result.success:
                yield {
                    "type": "novel_complete",
                    "url": url,
                    "title": result.novel.title,
                    "author": result.novel.author,
                    "chapters": len(result.novel.chapters),
                    "novel": _novel_to_dict(result.novel),
                }
            else:
                yield {
                    "type": "novel_error",
                    "url": url,
                    "error": result.error,
                }


def _novel_to_dict(novel: NovelInfo) -> dict:
    return {
        "title": novel.title,
        "author": novel.author,
        "source_url": novel.source_url,
        "chapters": [
            {
                "number": ch.number,
                "title": ch.title,
                "url": ch.url,
                "content": ch.content,
            }
            for ch in novel.chapters
        ],
    }
