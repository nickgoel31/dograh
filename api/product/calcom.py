"""Cal.com booking (API v2). Two small calls: free times on a day, and book one."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

BASE = "https://api.cal.com/v2"
SLOTS_VERSION, BOOKINGS_VERSION = "2024-09-04", "2026-02-25"


class CalError(Exception):
    """A problem with a message that is safe to say to the caller or show the customer."""


class CalCom:
    def __init__(self, api_key: str, transport=None):
        self._key, self._transport = api_key, transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=BASE, timeout=15, transport=self._transport, headers={"Authorization": f"Bearer {self._key}"})

    async def free_times(self, event_type_id: int, day: date, tz: str) -> list[datetime]:
        try:
            async with self._client() as c:
                r = await c.get("/slots", params={"eventTypeId": event_type_id, "start": day.isoformat(), "end": (day + timedelta(days=1)).isoformat(), "timeZone": tz},
                                headers={"cal-api-version": SLOTS_VERSION})
            r.raise_for_status()
            data = r.json().get("data", {})
        except Exception as e:  # noqa: BLE001
            raise CalError("We couldn't check the calendar right now.") from e
        out: list[datetime] = []
        for slots in (data.values() if isinstance(data, dict) else []):
            for s in slots:
                raw = s.get("start") if isinstance(s, dict) else s
                try:
                    out.append(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(ZoneInfo(tz)))
                except ValueError:
                    continue
        return sorted(out)

    async def book(self, event_type_id: int, start: datetime, name: str, tz: str, email: str | None, phone: str | None) -> dict:
        attendee = {"name": name, "timeZone": tz, "language": "en", **({"email": email} if email else {}), **({"phoneNumber": phone} if phone else {})}
        try:
            async with self._client() as c:
                r = await c.post("/bookings", json={"start": start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ"), "eventTypeId": event_type_id, "attendee": attendee},
                                 headers={"cal-api-version": BOOKINGS_VERSION})
        except Exception as e:  # noqa: BLE001
            raise CalError("We couldn't reach the calendar right now.") from e
        if r.status_code not in (200, 201):
            raise CalError("That time isn't free any more. Please pick another time.")
        return r.json().get("data", {})


def parse_when(text: str, tz: str) -> datetime:
    """'2026-03-05 15:30' (the business's local time) or a full ISO time -> an aware datetime."""
    t = (text or "").strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(t[:19] if fmt.endswith("%S") else t, fmt).replace(tzinfo=ZoneInfo(tz))
        except ValueError:
            continue
    try:
        d = datetime.fromisoformat((text or "").replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=ZoneInfo(tz))
    except ValueError as e:
        raise CalError("I didn't catch the time. Say it like 2026-03-05 15:30.") from e
