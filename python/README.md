# gr8mail

Official Python SDK for [Gr8Mail](https://mail.thegr8labs.com): send email from your own domain. No dependencies, Python 3.9+.

```bash
pip install gr8mail
```

```python
from gr8mail import Gr8Mail

mail = Gr8Mail("tg8_…")  # or set GR8MAIL_API_KEY

result = mail.emails.send({
    "from": "Acme <orders@acme.in>",
    "to": "priya@example.com",
    "subject": "Order #4821 shipped",
    "html": "<p>Your parcel is on its way.</p>",
})
print(result["id"])
```

## Sending

```python
from datetime import datetime, timedelta, timezone

mail.emails.send({
    "from": "billing@acme.in",
    "to": ["a@example.com", "b@example.com"],
    "reply_to": "support@acme.in",
    "subject": "Invoice",
    "text": "Attached.",
    "attachments": [{"filename": "invoice.pdf", "content": open("invoice.pdf", "rb").read()}],
    "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
}, idempotency_key="invoice-4821")

mail.emails.batch([email1, email2])   # up to 100
mail.emails.get(email_id)             # {"last_event": "delivered", ...}
mail.emails.cancel(email_id)          # scheduled emails only
```

## Domains, audiences, contacts, usage

Need a full-access API key that isn't limited to one domain.

```python
domain = mail.domains.create("mail.acme.in")
for r in domain["records"]:
    print(r["type"], r["name"], r["value"])
mail.domains.verify(domain["id"])

audience = mail.audiences.create("Newsletter")
mail.contacts.create(audience["id"], "priya@example.com", first_name="Priya")  # upsert
mail.contacts.update(audience["id"], "priya@example.com", unsubscribed=True)

usage = mail.usage.get()
print(usage["usage"]["emails_this_month"], "/", usage["limits"]["emails_per_month"])
```

## Errors

```python
import gr8mail

try:
    mail.emails.send(email)
except gr8mail.QuotaExceededError as e:
    print("Plan limit reached; resets in", e.retry_after, "seconds")
except gr8mail.ValidationError as e:
    print("Fix the request:", e.message)        # e.g. From domain not verified
except gr8mail.Gr8MailError as e:
    print(e.name, e.status_code, e.message)
```

`RateLimitError`, server errors and connection errors are retried automatically (twice by default) with
the same idempotency key, so a retry never sends twice.

## Async

```python
from gr8mail import AsyncGr8Mail

mail = AsyncGr8Mail()
await mail.emails.send({...})
```

## Django

```python
# settings.py: SMTP works with no code changes
EMAIL_HOST = "smtp.thegr8labs.com"
EMAIL_PORT = 465
EMAIL_USE_SSL = True
EMAIL_HOST_USER = "gr8mail"
EMAIL_HOST_PASSWORD = os.environ["GR8MAIL_API_KEY"]
```
