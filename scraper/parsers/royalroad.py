from __future__ import annotations

from bs4 import BeautifulSoup

from .base import BaseParser, Chapter, NovelInfo


class RoyalRoadParser(BaseParser):
    name = "royalroad"
    domains = ["royalroad.com"]

    async def get_novel_info(self, url: str, client) -> NovelInfo:
        html = await self.fetch_html(url, client)
        soup = BeautifulSoup(html, "lxml")

        title_tag = soup.select_one("h1.font-white, .fiction-info h1")
        title = title_tag.get_text(strip=True) if title_tag else "Untitled"

        author_tag = soup.select_one("h4.font-white a, .author a")
        author = author_tag.get_text(strip=True) if author_tag else "Unknown"

        chapters: list[Chapter] = []
        for i, row in enumerate(soup.select("table#chapters tbody tr"), start=1):
            link = row.select_one("a")
            if not link or not link.get("href"):
                continue
            chapters.append(
                Chapter(
                    number=i,
                    title=link.get_text(strip=True) or f"Chapter {i}",
                    url=self.absolute_url(url, link["href"]),
                )
            )

        return NovelInfo(title=title, author=author, source_url=url, chapters=chapters)

    async def fetch_chapter(self, chapter: Chapter, client) -> str:
        html = await self.fetch_html(chapter.url, client)
        soup = BeautifulSoup(html, "lxml")
        content = soup.select_one(".chapter-content, div.portlet-body")
        if not content:
            return ""
        for tag in content.find_all(["script", "style", "div"]):
            if tag.get("class") and any("author" in c for c in tag.get("class", [])):
                tag.decompose()
        paragraphs = [p.get_text(strip=True) for p in content.find_all("p") if p.get_text(strip=True)]
        return "\n\n".join(paragraphs)
