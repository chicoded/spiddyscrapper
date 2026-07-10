from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import Path

from .engine import sanitize_filename
from .parsers.base import NovelInfo


def export_novel_txt(novel: NovelInfo, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = sanitize_filename(novel.title) + ".txt"
    filepath = output_dir / filename

    lines = [
        novel.title,
        f"Author: {novel.author}",
        f"Source: {novel.source_url}",
        "",
        "=" * 60,
        "",
    ]

    for chapter in novel.chapters:
        lines.append(f"Chapter {chapter.number}: {chapter.title}")
        lines.append("-" * 40)
        lines.append(chapter.content or "[No content]")
        lines.append("")
        lines.append("")

    filepath.write_text("\n".join(lines), encoding="utf-8")
    return filepath


def export_novel_json(novel: NovelInfo, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = sanitize_filename(novel.title) + ".json"
    filepath = output_dir / filename

    data = {
        "title": novel.title,
        "author": novel.author,
        "source_url": novel.source_url,
        "chapters": [
            {"number": ch.number, "title": ch.title, "url": ch.url, "content": ch.content}
            for ch in novel.chapters
        ],
    }
    filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return filepath


def export_novel_epub(novel: NovelInfo, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = sanitize_filename(novel.title) + ".epub"
    filepath = output_dir / filename

    safe_title = _xml_escape(novel.title)
    safe_author = _xml_escape(novel.author)

    chapter_items = []
    chapter_toc = []
    spine = ['<itemref idref="nav"/>']

    for i, chapter in enumerate(novel.chapters, start=1):
        cid = f"chapter{i}"
        safe_ch_title = _xml_escape(chapter.title)
        content_html = _chapter_to_html(chapter)
        chapter_items.append(
            f'<item id="{cid}" href="{cid}.xhtml" media-type="application/xhtml+xml"/>'
        )
        chapter_toc.append(f'<li><a href="{cid}.xhtml">{safe_ch_title}</a></li>')
        spine.append(f'<itemref idref="{cid}"/>')

    opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{safe_title}</dc:title>
    <dc:creator>{safe_author}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">{safe_title}</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    {''.join(chapter_items)}
  </manifest>
  <spine>
    {''.join(spine)}
  </spine>
</package>"""

    nav = f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc"><ol>{''.join(chapter_toc)}</ol></nav>
</body>
</html>"""

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as epub:
        epub.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        epub.writestr("META-INF/container.xml", """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""")
        epub.writestr("content.opf", opf)
        epub.writestr("nav.xhtml", nav)
        for i, chapter in enumerate(novel.chapters, start=1):
            epub.writestr(f"chapter{i}.xhtml", _chapter_to_html(chapter, wrap_document=True))

    filepath.write_bytes(buffer.getvalue())
    return filepath


def export_novel(novel: NovelInfo, output_dir: Path, fmt: str = "txt") -> Path:
    if fmt == "json":
        return export_novel_json(novel, output_dir)
    if fmt == "epub":
        return export_novel_epub(novel, output_dir)
    return export_novel_txt(novel, output_dir)


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _chapter_to_html(chapter, wrap_document: bool = False) -> str:
    safe_title = _xml_escape(chapter.title)
    paragraphs = "".join(
        f"<p>{_xml_escape(p)}</p>" for p in (chapter.content or "").split("\n\n") if p.strip()
    )
    body = f"<h1>{safe_title}</h1>{paragraphs}"
    if wrap_document:
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{safe_title}</title></head>
<body>{body}</body>
</html>"""
    return body
