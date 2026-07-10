from __future__ import annotations

from .base import BaseParser
from .generic import GenericParser
from .novelfull import NovelFullParser
from .royalroad import RoyalRoadParser
from .webnovel import WebNovelParser

PARSERS: list[BaseParser] = [
    RoyalRoadParser(),
    NovelFullParser(),
    WebNovelParser(),
    GenericParser(),
]


def get_parser_for_url(url: str) -> BaseParser:
    for parser in PARSERS:
        if parser.matches(url):
            return parser
    return GenericParser()
