from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .base import BaseParser, Chapter, NovelInfo


class NovelFullParser(BaseParser):
    name = "novelfull"
    domains = [
        "novelfull.com",
        "novelfull.net",
        "readnovelfull.com",
        "novelbin.com",
        "novelbin.me",
        "novelbin.net",
        "lightnovelworld.com",
        "readlightnovel.org",
    ]

    async def get_novel_info(self, url: str, client) -> NovelInfo:
        html = await self.fetch_html(url, client)
        soup = BeautifulSoup(html, "lxml")

        title_tag = soup.select_one("h3.title, .desc h3.title, h1")
        title = title_tag.get_text(strip=True) if title_tag else "Untitled"

        author_tag = soup.select_one("a[href*='author'], .info a[href*='author']")
        author = author_tag.get_text(strip=True) if author_tag else "Unknown"

        chapters: list[Chapter] = []
        for i, a in enumerate(soup.select("#list-chapter a, .list-chapter a, ul.index a"), start=1):
            href = a.get("href", "").strip()
            if not href:
                continue
            chapters.append(
                Chapter(
                    number=i,
                    title=a.get_text(strip=True) or f"Chapter {i}",
                    url=self.absolute_url(url, href),
                )
            )

        if not chapters:
            ajax_url = self._ajax_url(url)
            if ajax_url:
                ajax_html = await self.fetch_html(ajax_url, client)
                ajax_soup = BeautifulSoup(ajax_html, "lxml")
                for i, a in enumerate(ajax_soup.select("a"), start=1):
                    href = a.get("href", "").strip()
                    if href:
                        chapters.append(
                            Chapter(
                                number=i,
                                title=a.get_text(strip=True) or f"Chapter {i}",
                                url=self.absolute_url(url, href),
                            )
                        )

        return NovelInfo(title=title, author=author, source_url=url, chapters=chapters)

    async def fetch_chapter(self, chapter: Chapter, client) -> str:
        html = await self.fetch_html(chapter.url, client)
        soup = BeautifulSoup(html, "lxml")
        content = soup.select_one("#chr-content, .chr-content, #chapter-content")
        if not content:
            return ""
        for tag in content.find_all(["script", "style", "ins", "iframe"]):
            tag.decompose()
        for tag in content.find_all(class_=re.compile(r"ads|hidden|affiliate", re.I)):
            tag.decompose()
        return "\n\n".join(p.get_text(strip=True) for p in content.find_all("p") if p.get_text(strip=True))

    def _ajax_url(self, url: str) -> str | None:
        match = re.search(r"(https?://[^/]+/[^/]+\.html)", url)
        if match:
            return match.group(1).replace(".html", "/ajax/chapter-options")
        return None
