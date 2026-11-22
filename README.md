# gr8mail-SDK

Official SDKs for [Gr8Mail](https://mail.thegr8labs.com): send transactional and marketing email from your own domain.

| Language | Package | Install | Docs |
|---|---|---|---|
| Node.js / TypeScript | [`node/`](node) | `npm install gr8mail` | [node/README.md](node/README.md) |
| Python | [`python/`](python) | `pip install gr8mail` | [python/README.md](python/README.md) |

```ts
import { Gr8Mail } from "gr8mail"

const mail = new Gr8Mail(process.env.GR8MAIL_API_KEY)
await mail.emails.send({
  from: "Acme <orders@acme.in>",
  to: "priya@example.com",
  subject: "Order #4821 shipped",
  html: "<p>Your parcel is on its way.</p>",
})
```

```python
from gr8mail import Gr8Mail

Gr8Mail().emails.send({
    "from": "Acme <orders@acme.in>",
    "to": "priya@example.com",
    "subject": "Order #4821 shipped",
    "html": "<p>Your parcel is on its way.</p>",
})
```

Both SDKs cover sending (single, batch, scheduled, attachments), email status, domains, audiences, contacts and usage,
with automatic retries and idempotency. Full documentation: https://mail.thegr8labs.com/docs

## Development

```bash
# Node
cd node && npm install && npm test

# Python
cd python && PYTHONPATH=src python -m unittest discover -s tests -v
```

Live tests run against a server when `GR8MAIL_TEST_URL` and `GR8MAIL_TEST_KEY` are set.

## License

MIT © thegr8labs
