"""Reads and chunks a document on this server, for when the platform's own document service (MPS) isn't available.

It handles what customers add: plain text, Q&A, web pages (HTML) and PDFs with selectable text. The result has the same shape as the
document service's, so the rest of the pipeline (embedding and storing) doesn't change.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

HIDDEN = {"script", "style", "noscript", "svg", "template", "iframe", "head"}
BLOCKS = {"p", "br", "li", "h1", "h2", "h3", "h4", "h5", "tr", "div", "section", "article", "table"}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._hide = 0

    def handle_starttag(self, tag, attrs):
        if tag in HIDDEN:
            self._hide += 1
        elif tag in BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in HIDDEN and self._hide:
            self._hide -= 1
        elif tag in BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._hide and data.strip():
            self.parts.append(data.strip() + " ")


def html_to_text(html: str) -> str:
    p = _Text()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 - broken markup: keep what was read
        pass
    return _tidy("".join(p.parts))


def _tidy(text: str) -> str:
    text = re.sub(r"[ \t\r\f]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def pdf_to_text(path: str) -> str:
    from pypdf import PdfReader  # imported here so a missing library gives a clear message, not a crash at start-up

    reader = PdfReader(path)
    return _tidy("\n\n".join((page.extract_text() or "") for page in reader.pages))


def read_text(path: str, filename: str, content_type: str) -> str:
    name, ctype = filename.lower(), (content_type or "").lower()
    if name.endswith(".pdf") or "pdf" in ctype:
        return pdf_to_text(path)
    raw = open(path, "rb").read()
    text = raw.decode("utf-8", errors="replace")
    if name.endswith((".html", ".htm")) or "html" in ctype:
        return html_to_text(text)
    return _tidy(text)


def chunk(text: str, max_tokens: int = 128) -> list[dict]:
    """Paragraph-aware pieces of about max_tokens words (never less than 90 so a piece carries a full thought)."""
    limit = max(int(max_tokens * 0.75), 90)
    pieces: list[str] = []
    cur: list[str] = []
    n = 0
    for para in [p.strip() for p in text.split("\n") if p.strip()]:
        words = para.split()
        if len(words) > limit:  # a very long paragraph: cut it
            if cur:
                pieces.append("\n".join(cur)); cur, n = [], 0
            for i in range(0, len(words), limit):
                pieces.append(" ".join(words[i:i + limit]))
            continue
        if n + len(words) > limit and cur:
            pieces.append("\n".join(cur)); cur, n = [], 0
        cur.append(para)
        n += len(words)
    if cur:
        pieces.append("\n".join(cur))
    return [{"chunk_text": t, "contextualized_text": t, "chunk_index": i, "chunk_metadata": {"source": "local"}, "token_count": int(len(t.split()) * 1.3)}
            for i, t in enumerate(pieces)]


def process(path: str, filename: str, content_type: str, retrieval_mode: str, max_tokens: int) -> dict:
    text = read_text(path, filename, content_type)
    if not text.strip():
        raise ValueError("No readable text was found in this file.")
    meta = {"converter": "local"}
    if retrieval_mode == "full_document":
        return {"mode": "full_document", "docling_metadata": meta, "full_text": text, "chunks": []}
    return {"mode": "chunked", "docling_metadata": meta, "full_text": None, "chunks": chunk(text, max_tokens)}
