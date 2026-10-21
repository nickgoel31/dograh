"""Fetch user-supplied URLs without letting them reach internal services (SSRF).

Knowledge-base URL sources make the server download whatever address a tenant
types in. Left unchecked that is a way to reach the cloud metadata endpoint
(169.254.169.254), Redis, Postgres or any other private service. This module:

* only allows http/https and rejects credentials embedded in the URL,
* resolves the hostname and refuses anything that is not a public address,
* connects to the *resolved IP* (pinning it, so DNS cannot change between the
  check and the request) while still sending the right Host header / TLS SNI,
* follows redirects manually and re-validates every hop,
* caps size and time, and only accepts document-like content types.

Set ``KB_URL_ALLOW_PRIVATE_HOSTS=true`` to allow private addresses (for example
an internal wiki on the same VPC).
"""

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from api.constants import KB_URL_ALLOW_PRIVATE_HOSTS

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT_SECONDS = 20.0
USER_AGENT = "SwarvoKnowledgeBot/1.0 (+knowledge-base-refresh)"

# content-type -> file extension used for processing
ALLOWED_CONTENT_TYPES = {
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/x-markdown": ".md",
    "application/json": ".json",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}


class UnsafeURLError(ValueError):
    """The URL is invalid or points somewhere we refuse to fetch from."""


class FetchError(RuntimeError):
    """The URL could not be downloaded (network error, bad status, too large...)."""


@dataclass
class FetchedContent:
    final_url: str
    content_type: str
    extension: str
    body: bytes
    etag: str | None = None
    last_modified: str | None = None


def _is_allowed_ip(ip: ipaddress._BaseAddress) -> bool:
    if KB_URL_ALLOW_PRIVATE_HOSTS:
        return not (ip.is_unspecified or ip.is_multicast)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _split(url: str):
    try:
        parts = urlsplit(url.strip())
    except ValueError as exc:
        raise UnsafeURLError("Invalid URL") from exc
    if parts.scheme not in ("http", "https"):
        raise UnsafeURLError("Only http and https URLs are supported")
    if not parts.hostname:
        raise UnsafeURLError("URL has no host")
    if parts.username or parts.password:
        raise UnsafeURLError("URLs with embedded credentials are not allowed")
    try:
        parts.port  # noqa: B018 - raises ValueError for an invalid port
    except ValueError as exc:
        raise UnsafeURLError("Invalid port") from exc
    return parts


async def resolve_public_ip(host: str, port: int) -> str:
    """Resolve ``host`` and return one address, refusing non-public targets."""
    try:
        literal = ipaddress.ip_address(host)
        infos = [(None, None, None, None, (str(literal), port))]
    except ValueError:
        loop = asyncio.get_running_loop()
        try:
            infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise UnsafeURLError(f"Could not resolve host '{host}'") from exc

    addresses = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not _is_allowed_ip(ip):
            raise UnsafeURLError("This address is not publicly reachable and cannot be used")
        addresses.append(str(ip))
    if not addresses:
        raise UnsafeURLError(f"Could not resolve host '{host}'")
    return addresses[0]


async def validate_public_url(url: str) -> str:
    """Raise ``UnsafeURLError`` unless ``url`` is a fetchable public http(s) URL."""
    parts = _split(url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    await resolve_public_ip(parts.hostname, port)
    return url.strip()


def _pinned_request_parts(parts, ip: str):
    """URL (with the IP as host), Host header and TLS SNI for a pinned connection."""
    host = parts.hostname
    port = parts.port
    default_port = 443 if parts.scheme == "https" else 80
    ip_host = f"[{ip}]" if ":" in ip else ip
    netloc = f"{ip_host}:{port}" if port else ip_host
    target = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
    host_header = host if (not port or port == default_port) else f"{host}:{port}"
    return target, host_header


async def fetch_url(
    url: str,
    *,
    max_bytes: int = MAX_BYTES,
    timeout: float = TIMEOUT_SECONDS,
    etag: str | None = None,
    last_modified: str | None = None,
) -> FetchedContent | None:
    """Download ``url`` safely.

    Returns ``None`` when the server answers 304 Not Modified to a conditional
    request (``etag`` / ``last_modified``), so unchanged pages cost nothing.
    """
    current = url.strip()
    async with httpx.AsyncClient(
        follow_redirects=False, timeout=timeout, headers={"User-Agent": USER_AGENT}
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            parts = _split(current)
            port = parts.port or (443 if parts.scheme == "https" else 80)
            ip = await resolve_public_ip(parts.hostname, port)
            target, host_header = _pinned_request_parts(parts, ip)

            headers = {"Host": host_header, "Accept": "text/html,text/plain,application/pdf,*/*;q=0.5"}
            if etag:
                headers["If-None-Match"] = etag
            if last_modified:
                headers["If-Modified-Since"] = last_modified
            extensions = {"sni_hostname": parts.hostname} if parts.scheme == "https" else {}

            try:
                async with client.stream(
                    "GET", target, headers=headers, extensions=extensions
                ) as response:
                    if response.status_code == 304:
                        return None
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("Redirect without a Location header")
                        current = urljoin(current, location)
                        continue
                    if response.status_code != 200:
                        raise FetchError(f"Server returned HTTP {response.status_code}")

                    content_type = (
                        response.headers.get("content-type", "").split(";")[0].strip().lower()
                    )
                    extension = ALLOWED_CONTENT_TYPES.get(content_type)
                    if extension is None:
                        raise FetchError(
                            f"Unsupported content type '{content_type or 'unknown'}'. "
                            "Use a web page, PDF, Word, text, markdown or JSON URL."
                        )

                    declared = response.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > max_bytes:
                        raise FetchError(_too_large(max_bytes))

                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > max_bytes:
                            raise FetchError(_too_large(max_bytes))

                    return FetchedContent(
                        final_url=current,
                        content_type=content_type,
                        extension=extension,
                        body=bytes(body),
                        etag=response.headers.get("etag"),
                        last_modified=response.headers.get("last-modified"),
                    )
            except httpx.HTTPError as exc:
                raise FetchError(f"Could not download the URL: {exc.__class__.__name__}") from exc

    raise FetchError("Too many redirects")


def _too_large(max_bytes: int) -> str:
    return f"The page is larger than the {max_bytes // (1024 * 1024)}MB limit"
