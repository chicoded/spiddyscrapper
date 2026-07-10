from __future__ import annotations

import json
import re

from bs4 import BeautifulSoup

from .base import BaseParser, Chapter, NovelInfo


class WebNovelParser(BaseParser):
    name = "webnovel"
    domains = ["webnovel.com"]

    async def get_novel_info(self, url: str, client) -> NovelInfo:
        html = await self.fetch_html(url, client)
        soup = BeautifulSoup(html, "lxml")

        title_tag = soup.select_one("h1.g_db, .det-hd h1, h1")
        title = title_tag.get_text(strip=True) if title_tag else "Untitled"

        author_tag = soup.select_one(".author .name, a[href*='author']")
        author = author_tag.get_text(strip=True) if author_tag else "Unknown"

        chapters: list[Chapter] = []
        for i, a in enumerate(soup.select("a.ell, .volume-item a, .chapter-item a"), start=1):
            href = a.get("href", "").strip()
            if not href or "chapter" not in href.lower():
                continue
            chapters.append(
                Chapter(
                    number=i,
                    title=a.get_text(strip=True) or f"Chapter {i}",
                    url=self.absolute_url(url, href),
                )
            )

        if not chapters:
            match = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});", html, re.S)
            if match:
                try:
                    data = json.loads(match.group(1))
                    chapter_list = (
                        data.get("chapter", {})
                        .get("chapterList", {})
                        .get("items", [])
                    )
                    for i, item in enumerate(chapter_list, start=1):
                        cid = item.get("id") or item.get("chapterId")
                        if cid:
                            chapters.append(
                                Chapter(
                                    number=i,
                                    title=item.get("name", f"Chapter {i}"),
                                    url=f"https://www.webnovel.com/book/{cid}",
                                )
                            )
                except (json.JSONDecodeError, AttributeError):
                    pass

        return NovelInfo(title=title, author=author, source_url=url, chapters=chapters)

    async def fetch_chapter(self, chapter: Chapter, client) -> str:
        html = await self.fetch_html(chapter.url, client)
        soup = BeautifulSoup(html, "lxml")
        content = soup.select_one(".cha-words, .chapter_content, .cha-content")
        if content:
            return "\n\n".join(
                p.get_text(strip=True) for p in content.find_all("p") if p.get_text(strip=True)
            )

        match = re.search(r'"chapterContent"\s*:\s*"((?:\\.|[^"\\])*)"', html)
        if match:
            raw = match.group(1)
            return raw.encode().decode("unicode_escape").replace("\\n", "\n\n")
        return ""
