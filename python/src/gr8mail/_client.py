from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Union

from ._errors import APIConnectionError, error_for

VERSION = "0.1.0"
DEFAULT_BASE_URL = "https://mailapi.thegr8labs.com"

Addresses = Union[str, Sequence[str]]
JSON = Dict[str, Any]


def _attachment(a: JSON) -> JSON:
    content = a.get("content")
    if isinstance(content, (bytes, bytearray, memoryview)):
        content = base64.b64encode(bytes(content)).decode()
    out = {"filename": a["filename"], "content": content}
    if a.get("content_type"):
        out["content_type"] = a["content_type"]
    return out


def _email_payload(email: JSON) -> JSON:
    body = {k: v for k, v in email.items() if v is not None}
    if isinstance(body.get("scheduled_at"), datetime):
        body["scheduled_at"] = body["scheduled_at"].isoformat()
    if "attachments" in body:
        body["attachments"] = [_attachment(a) for a in body["attachments"]]
    return body


class Gr8Mail:
    """Gr8Mail API client.

    >>> mail = Gr8Mail("tg8_…")            # or set GR8MAIL_API_KEY
    >>> mail.emails.send({"from": "Acme <orders@acme.in>", "to": "priya@example.com",
    ...                   "subject": "Shipped", "html": "<p>On its way</p>"})
    {'id': '…'}
    """

    def __init__(self, api_key: Optional[str] = None, *, base_url: Optional[str] = None,
                 max_retries: int = 2, timeout: float = 30.0):
        key = api_key or os.environ.get("GR8MAIL_API_KEY")
        if not key:
            raise ValueError('Missing API key. Pass Gr8Mail("tg8_…") or set GR8MAIL_API_KEY.')
        self._key = key
        self.base_url = (base_url or os.environ.get("GR8MAIL_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.max_retries = max_retries
        self.timeout = timeout
        self.emails = Emails(self)
        self.domains = Domains(self)
        self.audiences = Audiences(self)
        self.contacts = Contacts(self)
        self.usage = Usage(self)

    # -- transport (override _send in tests)
    def _send(self, req: urllib.request.Request):
        return urllib.request.urlopen(req, timeout=self.timeout)  # noqa: S310 - https API URL

    def request(self, method: str, path: str, body: Any = None, *, idempotency_key: Optional[str] = None) -> Any:
        headers = {
            "Authorization": f"Bearer {self._key}",
            "User-Agent": f"gr8mail-python/{VERSION}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        idem = idempotency_key
        if not idem and method == "POST" and path.startswith("/emails") and self.max_retries > 0:
            idem = str(uuid.uuid4())  # makes retrying a send safe
        if idem:
            headers["Idempotency-Key"] = idem
        can_retry = method != "POST" or bool(idem)

        attempt = 0
        while True:
            req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method, headers=headers)
            try:
                with self._send(req) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                raw = exc.read()
                exc.close()
                try:
                    payload = json.loads(raw) if raw else {}
                except ValueError:
                    payload = {}
                status = exc.code
                name = payload.get("name") or ("application_error" if status >= 500 else "unknown_error")
                retry_after = int(exc.headers.get("Retry-After") or 0) or None
                transient = status >= 500 or (status == 429 and name == "rate_limit_exceeded" and (retry_after or 1) <= 10)
                if transient and can_retry and attempt < self.max_retries:
                    time.sleep(retry_after if retry_after else 0.5 * 2 ** attempt)
                    attempt += 1
                    continue
                message = payload.get("message") or payload.get("detail") or f"Request failed with status {status}."
                raise error_for(name, message, status, retry_after) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if can_retry and attempt < self.max_retries:
                    time.sleep(0.5 * 2 ** attempt)
                    attempt += 1
                    continue
                reason = getattr(exc, "reason", exc)
                raise APIConnectionError(f"Couldn't reach Gr8Mail: {reason}", name="network_error") from None


class _Resource:
    def __init__(self, client: Gr8Mail):
        self._c = client


class Emails(_Resource):
    def send(self, email: JSON, *, idempotency_key: Optional[str] = None) -> JSON:
        """Send one email. Keys: from, to, subject, html/text, cc, bcc, reply_to, headers, tags,
        attachments [{filename, content (bytes or base64), content_type}], scheduled_at (datetime/ISO)."""
        return self._c.request("POST", "/emails", _email_payload(email), idempotency_key=idempotency_key)

    def batch(self, emails: List[JSON], *, idempotency_key: Optional[str] = None) -> JSON:
        """Send up to 100 emails; all are validated before any is sent."""
        return self._c.request("POST", "/emails/batch", [_email_payload(e) for e in emails], idempotency_key=idempotency_key)

    def get(self, email_id: str) -> JSON:
        return self._c.request("GET", f"/emails/{urllib.parse.quote(email_id)}")

    def cancel(self, email_id: str) -> JSON:
        return self._c.request("POST", f"/emails/{urllib.parse.quote(email_id)}/cancel")


class Domains(_Resource):
    def list(self) -> List[JSON]:
        return self._c.request("GET", "/domains")["data"]

    def create(self, name: str) -> JSON:
        """Add a domain; the response's `records` are the DNS records to publish."""
        return self._c.request("POST", "/domains", {"name": name})

    def get(self, domain_id: int) -> JSON:
        return self._c.request("GET", f"/domains/{int(domain_id)}")

    def verify(self, domain_id: int) -> JSON:
        return self._c.request("POST", f"/domains/{int(domain_id)}/verify")

    def remove(self, domain_id: int) -> JSON:
        return self._c.request("DELETE", f"/domains/{int(domain_id)}")


class Audiences(_Resource):
    def list(self) -> List[JSON]:
        return self._c.request("GET", "/audiences")["data"]

    def create(self, name: str) -> JSON:
        return self._c.request("POST", "/audiences", {"name": name})

    def get(self, audience_id: int) -> JSON:
        return self._c.request("GET", f"/audiences/{int(audience_id)}")

    def remove(self, audience_id: int) -> JSON:
        return self._c.request("DELETE", f"/audiences/{int(audience_id)}")


class Contacts(_Resource):
    @staticmethod
    def _path(audience_id: int, contact: Union[int, str, None] = None) -> str:
        p = f"/audiences/{int(audience_id)}/contacts"
        return p if contact is None else f"{p}/{urllib.parse.quote(str(contact), safe='')}"

    def create(self, audience_id: int, email: str, *, first_name: Optional[str] = None,
               last_name: Optional[str] = None, unsubscribed: Optional[bool] = None) -> JSON:
        """Add a contact, or update it if the email is already in the audience."""
        body = {"email": email, "first_name": first_name, "last_name": last_name, "unsubscribed": unsubscribed}
        return self._c.request("POST", self._path(audience_id), {k: v for k, v in body.items() if v is not None})

    def list(self, audience_id: int, *, limit: int = 50, offset: int = 0) -> JSON:
        """Returns {"data": [...], "has_more": bool}."""
        return self._c.request("GET", f"{self._path(audience_id)}?limit={int(limit)}&offset={int(offset)}")

    def get(self, audience_id: int, contact: Union[int, str]) -> JSON:
        """`contact` is the contact id or its email address."""
        return self._c.request("GET", self._path(audience_id, contact))

    def update(self, audience_id: int, contact: Union[int, str], *, first_name: Optional[str] = None,
               last_name: Optional[str] = None, unsubscribed: Optional[bool] = None) -> JSON:
        body = {"first_name": first_name, "last_name": last_name, "unsubscribed": unsubscribed}
        return self._c.request("PATCH", self._path(audience_id, contact), {k: v for k, v in body.items() if v is not None})

    def remove(self, audience_id: int, contact: Union[int, str]) -> JSON:
        return self._c.request("DELETE", self._path(audience_id, contact))


class Usage(_Resource):
    def get(self) -> JSON:
        """Plan name, limits (0 = unlimited) and emails sent today / this month."""
        return self._c.request("GET", "/usage")


class _AsyncProxy:
    def __init__(self, target):
        self._t = target

    def __getattr__(self, name):
        attr = getattr(self._t, name)
        if callable(attr):
            async def call(*args, **kwargs):
                return await asyncio.to_thread(attr, *args, **kwargs)
            return call
        return _AsyncProxy(attr)


class AsyncGr8Mail:
    """Async client with the same methods (`await mail.emails.send({...})`).

    Runs each request in a worker thread, so it needs no extra dependencies."""

    def __init__(self, api_key: Optional[str] = None, **options):
        self._sync = Gr8Mail(api_key, **options)
        self.emails = _AsyncProxy(self._sync.emails)
        self.domains = _AsyncProxy(self._sync.domains)
        self.audiences = _AsyncProxy(self._sync.audiences)
        self.contacts = _AsyncProxy(self._sync.contacts)
        self.usage = _AsyncProxy(self._sync.usage)
