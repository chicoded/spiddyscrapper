from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin, urlparse


@dataclass
class Chapter:
    number: int
    title: str
    url: str
    content: str = ""


@dataclass
class NovelInfo:
    title: str
    author: str = "Unknown"
    source_url: str = ""
    chapters: list[Chapter] = field(default_factory=list)


class BaseParser(ABC):
    name: str = "base"
    domains: list[str] = []

    def matches(self, url: str) -> bool:
        host = urlparse(url).netloc.lower().removeprefix("www.")
        return any(host == d or host.endswith("." + d) for d in self.domains)

    @abstractmethod
    async def get_novel_info(self, url: str, client) -> NovelInfo:
        ...

    @abstractmethod
    async def fetch_chapter(self, chapter: Chapter, client) -> str:
        ...

    async def fetch_html(self, url: str, client) -> str:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        return response.text

    def absolute_url(self, base: str, href: str) -> str:
        return urljoin(base, href)
