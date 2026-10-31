"""Sending email (invites, password reset, verification, receipts, alerts).

Configure with PRODUCT_SMTP_HOST, PRODUCT_SMTP_PORT (587), PRODUCT_SMTP_USER, PRODUCT_SMTP_PASSWORD and PRODUCT_EMAIL_FROM
(for example ``Swarvo AI <hello@swarvoai.com>``). Without them nothing is sent and callers fall back to showing a link.
"""

import asyncio
import os
import smtplib
from email.message import EmailMessage
from typing import Protocol

from api.product import config


class Mailer(Protocol):
    enabled: bool

    async def send(self, to: str, subject: str, text: str, html: str | None = None) -> bool: ...


class SmtpMailer:
    def __init__(self):
        self.host = os.getenv("PRODUCT_SMTP_HOST", "")
        self.port = int(os.getenv("PRODUCT_SMTP_PORT", "587") or 587)
        self.user, self.password = os.getenv("PRODUCT_SMTP_USER", ""), os.getenv("PRODUCT_SMTP_PASSWORD", "")
        self.sender = os.getenv("PRODUCT_EMAIL_FROM", "") or (f"{config.PRODUCT_NAME} <{self.user}>" if self.user else "")

    @property
    def enabled(self) -> bool:
        return bool(self.host and self.sender)

    def _send(self, to: str, subject: str, text: str, html: str | None) -> None:
        m = EmailMessage()
        m["From"], m["To"], m["Subject"] = self.sender, to, subject
        m.set_content(text)
        if html:
            m.add_alternative(html, subtype="html")
        with smtplib.SMTP(self.host, self.port, timeout=15) as s:
            if self.port != 25:
                s.starttls()
            if self.user:
                s.login(self.user, self.password)
            s.send_message(m)

    async def send(self, to, subject, text, html=None) -> bool:
        if not self.enabled:
            return False
        try:
            await asyncio.to_thread(self._send, to, subject, text, html)
            return True
        except Exception:  # noqa: BLE001 - a mail problem must never break the request that triggered it
            return False


_mailer = SmtpMailer()


def get_mailer() -> Mailer:
    return _mailer


def app_url() -> str:
    """Where the new app lives, for links in emails. Set PRODUCT_APP_URL, e.g. https://app.swarvoai.com/new"""
    return os.getenv("PRODUCT_APP_URL", "").rstrip("/")


def wrap(title: str, body_html: str, button: tuple[str, str] | None = None) -> str:
    btn = f'<p style="margin:24px 0"><a href="{button[1]}" style="background:#0b5c4c;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">{button[0]}</a></p>' if button else ""
    return (f'<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#10211d"><h2 style="margin:0 0 12px">{title}</h2>'
            f'{body_html}{btn}<p style="color:#6b7a76;font-size:12px;margin-top:32px">{config.PRODUCT_NAME}</p></div>')
