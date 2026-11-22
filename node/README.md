# gr8mail

Official Node.js / TypeScript SDK for [Gr8Mail](https://mail.thegr8labs.com): send email from your own domain.

```bash
npm install gr8mail
```

```ts
import { Gr8Mail } from "gr8mail"

const mail = new Gr8Mail(process.env.GR8MAIL_API_KEY)

const { data, error } = await mail.emails.send({
  from: "Acme <orders@acme.in>",
  to: "priya@example.com",
  subject: "Order #4821 shipped",
  html: "<p>Your parcel is on its way.</p>",
})

if (error) console.error(error.name, error.message)
else console.log("Sent", data.id)
```

Works on Node 18+, Bun, Deno, Cloudflare Workers and Vercel Edge. No dependencies.

## Sending

```ts
// Attachments (Buffer, Uint8Array or base64 string), up to 18 MB total
await mail.emails.send({
  from: "billing@acme.in",
  to: ["a@example.com", "b@example.com"],
  cc: "accounts@acme.in",
  replyTo: "support@acme.in",
  subject: "Invoice",
  text: "Attached.",
  attachments: [{ filename: "invoice.pdf", content: await fs.readFile("invoice.pdf") }],
  headers: { "X-Entity-Ref-ID": "inv-4821" },
  tags: [{ name: "type", value: "invoice" }],
})

// Schedule, then cancel if needed
const { data } = await mail.emails.send({ ...email, scheduledAt: new Date(Date.now() + 3600_000) })
await mail.emails.cancel(data!.id)

// Up to 100 emails in one call (all validated before any is sent)
await mail.emails.batch([email1, email2])

// Status lookup (full-access key)
const { data: e } = await mail.emails.get(id) // e.lastEvent: "delivered" | "bounced" | …
```

## Domains, audiences, contacts, usage

These need a **full-access** API key that isn't limited to one domain.

```ts
const { data: domain } = await mail.domains.create({ name: "mail.acme.in" })
console.table(domain!.records) // publish these DNS records
await mail.domains.verify(domain!.id)

const { data: list } = await mail.audiences.create({ name: "Newsletter" })
await mail.contacts.create({ audienceId: list!.id, email: "priya@example.com", firstName: "Priya" }) // upsert
await mail.contacts.update({ audienceId: list!.id, id: "priya@example.com", unsubscribed: true })

const { data: usage } = await mail.usage.get()
console.log(`${usage!.usage.emailsThisMonth} / ${usage!.limits.emailsPerMonth} this month`)
```

## Errors

Methods never throw for API errors; they resolve to `{ data, error }`.

| `error.name` | Meaning |
|---|---|
| `invalid_from_address` | The From domain isn't added or verified on your account |
| `validation_error` | Something in the request is wrong; `message` says what |
| `rate_limit_exceeded` | Too many per second/minute; retried automatically |
| `quota_exceeded` | Daily or monthly plan limit reached; `retryAfter` says when it resets |
| `plan_limit_reached` | Your plan doesn't allow more domains/contacts |
| `account_suspended` | Sending is paused for your account |
| `restricted_api_key` | Use a full-access key for this call |
| `network_error` | Couldn't reach Gr8Mail (after retries) |

## Options

```ts
new Gr8Mail(apiKey, {
  baseUrl: "https://mailapi.thegr8labs.com", // or GR8MAIL_BASE_URL
  maxRetries: 2,   // network errors, 5xx, short rate limits
  timeout: 30_000, // ms
})
```

Sends are retried with an automatic idempotency key, so a retry never sends twice. Pass your own with
`mail.emails.send(email, { idempotencyKey: "order-4821" })`.

## SMTP

Apps that only speak SMTP can use `smtp.thegr8labs.com`, port 465 (TLS) or 587 (STARTTLS), username `gr8mail` (any value works), password = your API key.
