"""Reads a business's website so an agent can be set up from it: the home page plus the few pages most likely to say what the business does.

Fetching goes through the platform's safe downloader, which refuses internal addresses, so a customer cannot point this at our own network.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

MAX_PAGES = 6
PAGE_TEXT = 6000
TOTAL_TEXT = 22000
PAGE_BYTES = 1_500_000
PAGE_TIMEOUT = 10.0

# Pages worth reading, best first. A link matches when its address or its words contain the keyword.
KEYWORDS = ("about", "service", "treatment", "product", "menu", "price", "pricing", "fee", "course", "faq", "contact", "location", "hours", "appointment", "team", "offer", "plan")
SKIP_EXT = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".zip", ".mp4", ".mp3", ".doc", ".docx", ".xls", ".xlsx", ".css", ".js")
HIDDEN = {"script", "style", "noscript", "svg", "template", "iframe"}

Fetcher = Callable[..., Awaitable]


@dataclass
class Page:
    url: str
    title: str = ""
    description: str = ""
    text: str = ""
    links: list[tuple[str, str]] = field(default_factory=list)  # (address, link words)


class _Extract(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.description = "", ""
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._hide = 0
        self._in_title = False
        self._href: str | None = None
        self._link_words: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in HIDDEN:
            self._hide += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "meta" and (a.get("name") or a.get("property") or "").lower() in ("description", "og:description") and not self.description:
            self.description = (a.get("content") or "").strip()
        elif tag == "a" and a.get("href"):
            self._href, self._link_words = a["href"], []
        elif tag in ("p", "br", "li", "h1", "h2", "h3", "h4", "tr", "div", "section"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in HIDDEN and self._hide:
            self._hide -= 1
        elif tag == "title":
            self._in_title = False
        elif tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._link_words).strip()))
            self._href = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
            return
        if self._hide:
            return
        t = data.strip()
        if t:
            self.parts.append(t + " ")
            if self._href is not None:
                self._link_words.append(t)


def parse_page(url: str, html: str) -> Page:
    p = _Extract()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 - broken markup: keep what was read
        pass
    text = re.sub(r"[ \t\r\f]+", " ", "".join(p.parts))
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return Page(url=url, title=re.sub(r"\s+", " ", p.title).strip()[:160], description=p.description[:400], text=text[:PAGE_TEXT], links=p.links)


def normalise(url: str) -> str:
    u = (url or "").strip()
    if u and "://" not in u:
        u = "https://" + u
    return u


def _host(u: str) -> str:
    return (urlsplit(u).hostname or "").lower().removeprefix("www.")


def pick_links(base: str, links: list[tuple[str, str]], limit: int = MAX_PAGES - 1) -> list[str]:
    """The pages on the same site most likely to describe the business."""
    host, seen, scored = _host(base), {base.rstrip("/")}, []
    for href, words in links:
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(base, href).split("#")[0]
        parts = urlsplit(full)
        if parts.scheme not in ("http", "https") or _host(full) != host or parts.path.lower().endswith(SKIP_EXT):
            continue
        key = full.rstrip("/")
        if key in seen:
            continue
        hay = (parts.path + " " + words).lower()
        rank = next((i for i, k in enumerate(KEYWORDS) if k in hay), None)
        if rank is not None:
            seen.add(key)
            scored.append((rank, len(parts.path), full))
    return [u for _, _, u in sorted(scored)[:limit]]


async def read_site(url: str, fetch: Fetcher | None = None, max_pages: int = MAX_PAGES) -> list[Page]:
    """The home page and the best few pages it links to. Raises ValueError (plain words) when the home page can't be read."""
    from api.utils import safe_fetch

    fetch = fetch or safe_fetch.fetch_url
    start = normalise(url)

    async def one(u: str) -> Page | None:
        try:
            got = await fetch(u, max_bytes=PAGE_BYTES, timeout=PAGE_TIMEOUT)
        except (safe_fetch.UnsafeURLError, safe_fetch.FetchError, ValueError):
            return None
        except Exception:  # noqa: BLE001
            return None
        if got is None or got.content_type not in ("text/html", "application/xhtml+xml", "text/plain"):
            return None
        return parse_page(got.final_url, got.body.decode("utf-8", errors="replace"))

    home = await one(start)
    if home is None or not (home.text or home.description):
        raise ValueError("We couldn't read that website. Check the address, or tell me about your business instead.")
    wanted = pick_links(home.url, home.links, max_pages - 1)
    gate = asyncio.Semaphore(3)

    async def limited(u: str):
        async with gate:
            return await one(u)

    rest = [p for p in await asyncio.gather(*(limited(u) for u in wanted)) if p is not None and p.text]
    pages, budget = [home, *rest], TOTAL_TEXT
    for p in pages:  # keep the total small enough for the model
        p.text, budget = p.text[: max(0, budget)], budget - len(p.text)
    return [p for p in pages if p.text or p.description]
