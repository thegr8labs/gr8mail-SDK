import asyncio
import io
import json
import os
import unittest
import urllib.error
from email.message import Message

import gr8mail
from gr8mail import Gr8Mail


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(status, body, headers=None):
    h = Message()
    for k, v in (headers or {}).items():
        h[k] = v
    return urllib.error.HTTPError("u", status, "err", h, io.BytesIO(json.dumps(body).encode()))


class Client(Gr8Mail):
    def __init__(self, responses, **kw):
        super().__init__("tg8_x", base_url="https://api.test/", **kw)
        self.responses = list(responses)
        self.calls = []

    def _send(self, req):
        self.calls.append(req)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return FakeResp(json.dumps(r).encode())


class Tests(unittest.TestCase):
    def setUp(self):
        import time
        self._sleep = time.sleep
        time.sleep = lambda s: None

    def tearDown(self):
        import time
        time.sleep = self._sleep

    def test_send(self):
        c = Client([{"id": "abc"}])
        out = c.emails.send({"from": "a@acme.in", "to": "b@x.com", "subject": "s", "html": "<p>x</p>",
                             "attachments": [{"filename": "a.txt", "content": b"hello"}], "cc": None})
        self.assertEqual(out, {"id": "abc"})
        req = c.calls[0]
        self.assertEqual(req.full_url, "https://api.test/emails")
        self.assertEqual(req.get_header("Authorization"), "Bearer tg8_x")
        self.assertTrue(req.get_header("Idempotency-key"))
        body = json.loads(req.data)
        self.assertNotIn("cc", body)
        self.assertEqual(body["attachments"][0]["content"], "aGVsbG8=")

    def test_quota_error_raised_not_retried(self):
        c = Client([http_error(429, {"name": "quota_exceeded", "message": "Monthly limit"}, {"Retry-After": "3600"})])
        with self.assertRaises(gr8mail.QuotaExceededError) as ctx:
            c.emails.send({"from": "a@a.in", "to": "b@b.com", "subject": "s", "text": "t"})
        self.assertEqual(ctx.exception.retry_after, 3600)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(len(c.calls), 1)

    def test_retries_with_same_idempotency_key(self):
        c = Client([http_error(502, {}), http_error(429, {"name": "rate_limit_exceeded"}, {"Retry-After": "1"}), {"id": "ok"}])
        self.assertEqual(c.emails.send({"from": "a@a.in", "to": "b@b.com", "subject": "s", "text": "t"}), {"id": "ok"})
        self.assertEqual(len({r.get_header("Idempotency-key") for r in c.calls}), 1)

    def test_connection_error(self):
        c = Client([urllib.error.URLError("down")] * 3)
        with self.assertRaises(gr8mail.APIConnectionError):
            c.domains.list()
        self.assertEqual(len(c.calls), 3)

    def test_not_found_and_validation(self):
        c = Client([http_error(404, {"name": "not_found", "message": "Domain not found."}),
                    http_error(403, {"name": "invalid_from_address", "message": "not verified"})])
        with self.assertRaises(gr8mail.NotFoundError):
            c.domains.get(5)
        with self.assertRaises(gr8mail.ValidationError):
            c.emails.send({"from": "a@a.in", "to": "b@b.com", "subject": "s", "text": "t"})

    def test_contacts_paths(self):
        c = Client([{"id": 1}, {}])
        c.contacts.create(7, "p@x.com", first_name="Priya")
        self.assertEqual(c.calls[0].full_url, "https://api.test/audiences/7/contacts")
        self.assertEqual(json.loads(c.calls[0].data), {"email": "p@x.com", "first_name": "Priya"})
        c.contacts.update(7, "p@x.com", unsubscribed=True)
        self.assertEqual(c.calls[1].full_url, "https://api.test/audiences/7/contacts/p%40x.com")
        self.assertEqual(c.calls[1].get_method(), "PATCH")

    def test_missing_key(self):
        saved = os.environ.pop("GR8MAIL_API_KEY", None)
        with self.assertRaises(ValueError):
            Gr8Mail()
        if saved:
            os.environ["GR8MAIL_API_KEY"] = saved

    def test_async(self):
        c = gr8mail.AsyncGr8Mail("tg8_x")
        c._sync.__class__ = Client
        c._sync.responses, c._sync.calls = [{"id": "z"}], []
        out = asyncio.run(c.emails.send({"from": "a@a.in", "to": "b@b.com", "subject": "s", "text": "t"}))
        self.assertEqual(out, {"id": "z"})


@unittest.skipUnless(os.environ.get("GR8MAIL_TEST_KEY"), "set GR8MAIL_TEST_KEY/GR8MAIL_TEST_URL for live test")
class Integration(unittest.TestCase):
    def test_live(self):
        mail = Gr8Mail(os.environ["GR8MAIL_TEST_KEY"], base_url=os.environ.get("GR8MAIL_TEST_URL"))
        self.assertIn("limits", mail.usage.get())
        aud = mail.audiences.create("Py SDK test")
        mail.contacts.create(aud["id"], "py@example.com", first_name="Py")
        self.assertEqual(len(mail.contacts.list(aud["id"])["data"]), 1)
        self.assertTrue(mail.audiences.remove(aud["id"])["deleted"])
        with self.assertRaises(gr8mail.ValidationError):
            mail.emails.send({"from": "x@not-mine.example", "to": "a@b.com", "subject": "s", "text": "t"})


if __name__ == "__main__":
    unittest.main()
