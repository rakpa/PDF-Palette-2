"""
Extract structured profiles from PDF pages for fidelity validation.

Uses PyMuPDF object coordinates and span metadata — not reflowed text.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from pathlib import Path

MONOSPACE_HINTS = (
    "courier",
    "consolas",
    "mono",
    "menlo",
    "source code",
    "coding",
    "fixedsys",
    "lucida console",
    "dejavu sans mono",
    "liberation mono",
    "andale mono",
    "sf mono",
    "fira code",
    "jetbrains",
)

CODE_LINE_RE = re.compile(
    r"^(\s{2,}|\t|#include|def |class |function |const |let |var |import |from |"
    r"public |private |<\?|SELECT |INSERT |CREATE |```|\{|\})"
)
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
CAPTION_RE = re.compile(
    r"(?:^|\s)((?:Figure|Fig\.|Table|Tab\.)\s*\d+[\w.:;\-]*)",
    re.I,
)
REFERENCE_RE = re.compile(r"\[[\d,\s\-]+\]|\(\d{4}\)|doi:\s*\S+", re.I)

WORD_RE = re.compile(r"\b[\w][\w\-']*\b", re.UNICODE)


def _normalize_words(text: str) -> set[str]:
    return {w.lower() for w in WORD_RE.findall(text)}


def _is_monospace_font(font: str) -> bool:
    lower = (font or "").lower()
    return any(hint in lower for hint in MONOSPACE_HINTS)


@dataclass
class SpanInfo:
    text: str
    font: str
    size: float
    bbox: tuple[float, float, float, float]
    flags: int


@dataclass
class PageProfile:
    index: int
    width: float
    height: float
    margin: tuple[float, float, float, float]
    text: str
    words: set[str]
    image_count: int
    heading_count: int
    code_block_count: int
    caption_texts: list[str]
    url_texts: list[str]
    reference_texts: list[str]
    monospace_snippets: list[str] = field(default_factory=list)
    code_lines: list[str] = field(default_factory=list)


@dataclass
class DocumentProfile:
    path: str
    page_count: int
    text_chars: int
    image_count: int
    heading_count: int
    code_block_count: int
    caption_count: int
    url_count: int
    reference_count: int
    pages: list[PageProfile]
    likely_scanned: bool
    all_words: set[str]
    monospace_snippets: list[str]
    code_lines: list[str]

    def aggregate(self) -> dict:
        return {
            "page_count": self.page_count,
            "text_chars": self.text_chars,
            "image_count": self.image_count,
            "heading_count": self.heading_count,
            "code_block_count": self.code_block_count,
            "caption_count": self.caption_count,
            "url_count": self.url_count,
            "reference_count": self.reference_count,
            "likely_scanned": self.likely_scanned,
        }


def _count_code_blocks(lines: list[tuple[str, bool, str]]) -> int:
    """Count contiguous monospace / code-like line groups."""
    blocks = 0
    in_block = False
    for _text, is_mono, _font in lines:
        is_code = is_mono or (_text.strip() and CODE_LINE_RE.match(_text.strip()))
        if is_code and not in_block:
            blocks += 1
            in_block = True
        elif not is_code:
            in_block = False
    return blocks


def _detect_headings(spans: list[SpanInfo]) -> int:
    sizes = [s.size for s in spans if s.text.strip() and s.size > 0]
    if not sizes:
        return 0
    median = statistics.median(sizes)
    threshold = median * 1.12
    headings = 0
    seen: set[str] = set()
    for span in spans:
        t = span.text.strip()
        if not t or len(t) > 220:
            continue
        if span.size < threshold:
            continue
        if t.endswith(".") and len(t.split()) > 8:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        headings += 1
    return headings


def _page_margin_estimate(page_dict: dict, width: float, height: float) -> tuple[float, float, float, float]:
    """Estimate margins from text block extents (left, right, top, bottom)."""
    xs0: list[float] = []
    xs1: list[float] = []
    ys0: list[float] = []
    ys1: list[float] = []
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        x0, y0, x1, y1 = block.get("bbox", (0, 0, width, height))
        xs0.append(x0)
        xs1.append(x1)
        ys0.append(y0)
        ys1.append(y1)
    if not xs0:
        return (72.0, 72.0, 72.0, 72.0)
    return (
        max(0.0, min(xs0)),
        max(0.0, width - max(xs1)),
        max(0.0, min(ys0)),
        max(0.0, height - max(ys1)),
    )


def analyze_page(page, index: int) -> PageProfile:
    rect = page.rect
    width, height = rect.width, rect.height
    page_dict = page.get_text("dict")
    text = page.get_text("text") or ""
    words = _normalize_words(text)

    spans: list[SpanInfo] = []
    line_records: list[tuple[str, bool, str]] = []
    mono_snippets: set[str] = set()
    code_lines: set[str] = set()

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            line_text = "".join(span.get("text", "") for span in line.get("spans", []))
            line_mono = False
            line_font = ""
            for span in line.get("spans", []):
                font = span.get("font", "")
                size = float(span.get("size", 0))
                bbox = tuple(span.get("bbox", (0, 0, 0, 0)))
                snippet = (span.get("text") or "").strip()
                spans.append(
                    SpanInfo(
                        text=span.get("text", ""),
                        font=font,
                        size=size,
                        bbox=bbox,  # type: ignore[arg-type]
                        flags=int(span.get("flags", 0)),
                    )
                )
                if snippet and _is_monospace_font(font):
                    mono_snippets.add(snippet[:500])
                    line_mono = True
                    line_font = font
                stripped = line_text.strip()
                if stripped and CODE_LINE_RE.match(stripped):
                    code_lines.add(stripped[:500])
            line_records.append((line_text, line_mono, line_font))

    captions = [m.group(1).strip() for m in CAPTION_RE.finditer(text)]
    urls = URL_RE.findall(text)
    references = REFERENCE_RE.findall(text)
    margin = _page_margin_estimate(page_dict, width, height)

    return PageProfile(
        index=index,
        width=width,
        height=height,
        margin=margin,
        text=text,
        words=words,
        image_count=len(page.get_images(full=True)),
        heading_count=_detect_headings(spans),
        code_block_count=_count_code_blocks(line_records),
        caption_texts=captions,
        url_texts=urls,
        reference_texts=references,
        monospace_snippets=sorted(mono_snippets),
        code_lines=sorted(code_lines),
    )


def analyze_pdf(pdf_path: Path) -> DocumentProfile:
    import pymupdf as fitz

    doc = fitz.open(pdf_path)
    pages: list[PageProfile] = []
    all_words: set[str] = set()
    mono: set[str] = set()
    code: set[str] = set()
    text_chars = 0
    image_count = 0

    for i in range(doc.page_count):
        profile = analyze_page(doc[i], i)
        pages.append(profile)
        all_words |= profile.words
        text_chars += len(profile.text.strip())
        image_count += profile.image_count
        mono.update(profile.monospace_snippets)
        code.update(profile.code_lines)

    page_count = doc.page_count
    doc.close()

    return DocumentProfile(
        path=str(pdf_path),
        page_count=page_count,
        text_chars=text_chars,
        image_count=image_count,
        heading_count=sum(p.heading_count for p in pages),
        code_block_count=sum(p.code_block_count for p in pages),
        caption_count=sum(len(p.caption_texts) for p in pages),
        url_count=sum(len(p.url_texts) for p in pages),
        reference_count=sum(len(p.reference_texts) for p in pages),
        pages=pages,
        likely_scanned=page_count > 0 and text_chars < 10,
        all_words=all_words,
        monospace_snippets=sorted(mono),
        code_lines=sorted(code),
    )
