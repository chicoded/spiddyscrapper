from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .base import BaseParser, Chapter, NovelInfo


CONTENT_SELECTORS = [
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
]

CHAPTER_LINK_PATTERNS = [
    re.compile(r"chapter[-_]?\d+", re.I),
    re.compile(r"ch[-_]?\d+", re.I),
    re.compile(r"/\d+/?$"),
]


class GenericParser(BaseParser):
    name = "generic"
    domains: list[str] = []

    def matches(self, url: str) -> bool:
        return True

    async def get_novel_info(self, url: str, client) -> NovelInfo:
        html = await self.fetch_html(url, client)
        soup = BeautifulSoup(html, "lxml")

        title = self._extract_title(soup, url)
        author = self._extract_author(soup)
        chapters = self._extract_chapters(soup, url)

        if not chapters:
            chapters = [Chapter(number=1, title="Chapter 1", url=url)]

        return NovelInfo(
            title=title,
            author=author,
            source_url=url,
            chapters=chapters,
        )

    async def fetch_chapter(self, chapter: Chapter, client) -> str:
        html = await self.fetch_html(chapter.url, client)
        soup = BeautifulSoup(html, "lxml")
        return self._extract_content(soup)

    def _extract_title(self, soup: BeautifulSoup, url: str) -> str:
        for selector in ["h1.book-title", "h1.entry-title", ".book-info h1", "h1"]:
            tag = soup.select_one(selector)
            if tag and tag.get_text(strip=True):
                return tag.get_text(strip=True)
        return urlparse(url).path.strip("/").replace("-", " ").title() or "Untitled Novel"

    def _extract_author(self, soup: BeautifulSoup) -> str:
        for selector in [".author", "a[href*='author']", ".book-author", "span.author"]:
            tag = soup.select_one(selector)
            if tag and tag.get_text(strip=True):
                return tag.get_text(strip=True).removeprefix("Author:").strip()
        return "Unknown"

    def _extract_chapters(self, soup: BeautifulSoup, base_url: str) -> list[Chapter]:
        links: list[tuple[str, str]] = []
        seen: set[str] = set()

        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            text = a.get_text(strip=True)
            if not text or len(text) > 200:
                continue
            full_url = self.absolute_url(base_url, href)
            if full_url in seen:
                continue
            if any(p.search(href) or p.search(text) for p in CHAPTER_LINK_PATTERNS):
                seen.add(full_url)
                links.append((text, full_url))

        if len(links) < 3:
            toc = soup.select_one("#list-chapter, .list-chapter, #chapter-list, .chapter-list, ul.index")
            if toc:
                for a in toc.find_all("a", href=True):
                    href = a["href"].strip()
                    text = a.get_text(strip=True)
                    full_url = self.absolute_url(base_url, href)
                    if full_url not in seen and text:
                        seen.add(full_url)
                        links.append((text, full_url))

        chapters: list[Chapter] = []
        for i, (title, chapter_url) in enumerate(links, start=1):
            chapters.append(Chapter(number=i, title=title, url=chapter_url))
        return chapters

    def _extract_content(self, soup: BeautifulSoup) -> str:
        for selector in CONTENT_SELECTORS:
            node = soup.select_one(selector)
            if node:
                return self._clean_content(node)

        for tag in soup.find_all(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()

        main = soup.find("main") or soup.body
        if main:
            return self._clean_content(main)
        return ""

    def _clean_content(self, node) -> str:
        for tag in node.find_all(["script", "style", "iframe", "ins", "noscript"]):
            tag.decompose()
        for tag in node.find_all(class_=re.compile(r"ads|advert|banner|social|share", re.I)):
            tag.decompose()

        paragraphs = []
        for p in node.find_all(["p", "br"]):
            if p.name == "br":
                paragraphs.append("")
            else:
                text = p.get_text(" ", strip=True)
                if text:
                    paragraphs.append(text)

        if paragraphs:
            return "\n\n".join(paragraphs)

        text = node.get_text("\n", strip=True)
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n\n".join(lines)
