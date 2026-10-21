import pytest

from api.utils import safe_fetch
from api.utils.safe_fetch import UnsafeURLError, validate_public_url

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://127.0.0.1:6379/",
        "http://localhost/admin",
        "http://10.0.0.5/",
        "http://192.168.1.10/",
        "http://100.64.0.1/",  # carrier-grade NAT
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://0.0.0.0/",
        "file:///etc/passwd",
        "ftp://example.com/x",
        "http://user:pass@example.com/",
        "http:///nohost",
    ],
)
async def test_internal_and_invalid_urls_are_rejected(url):
    with pytest.raises(UnsafeURLError):
        await validate_public_url(url)


async def test_hostname_resolving_to_private_ip_is_rejected(monkeypatch):
    async def fake_getaddrinfo(host, port, **kw):
        return [(2, 1, 6, "", ("10.1.2.3", port))]

    loop = __import__("asyncio").get_running_loop()
    monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(UnsafeURLError):
        await validate_public_url("http://innocent.example.com/")


async def test_mixed_public_and_private_answers_are_rejected(monkeypatch):
    async def fake_getaddrinfo(host, port, **kw):
        return [(2, 1, 6, "", ("93.184.216.34", port)), (2, 1, 6, "", ("127.0.0.1", port))]

    loop = __import__("asyncio").get_running_loop()
    monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(UnsafeURLError):
        await validate_public_url("http://rebinder.example.com/")


async def test_public_ip_literal_is_allowed():
    assert await validate_public_url("https://93.184.216.34/page") == "https://93.184.216.34/page"


def test_pinned_request_keeps_host_header_and_port():
    parts = safe_fetch._split("https://docs.example.com:8443/a?b=1")
    target, host = safe_fetch._pinned_request_parts(parts, "93.184.216.34")
    assert target == "https://93.184.216.34:8443/a?b=1"
    assert host == "docs.example.com:8443"
    parts = safe_fetch._split("https://docs.example.com/a")
    assert safe_fetch._pinned_request_parts(parts, "2606:2800::1")[0] == "https://[2606:2800::1]/a"
