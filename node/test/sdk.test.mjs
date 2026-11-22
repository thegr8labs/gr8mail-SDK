import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

import { Gr8Mail } from "../dist/esm/index.js"

function mockFetch(responses) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const r = responses.shift()
    if (r instanceof Error) throw r
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers ?? {} })
  }
  fn.calls = calls
  return fn
}

test("send maps camelCase to the API and returns data", async () => {
  const fetch = mockFetch([{ body: { id: "abc" } }])
  const mail = new Gr8Mail("tg8_x", { fetch, baseUrl: "https://api.test/" })
  const { data, error } = await mail.emails.send({
    from: "a@acme.in", to: "b@x.com", subject: "Hi", html: "<p>x</p>", replyTo: "r@acme.in",
    scheduledAt: new Date("2030-01-01T00:00:00Z"),
    attachments: [{ filename: "a.txt", content: new TextEncoder().encode("hello"), contentType: "text/plain" }],
  })
  assert.equal(error, null)
  assert.deepEqual(data, { id: "abc" })
  const c = fetch.calls[0]
  assert.equal(c.url, "https://api.test/emails")
  assert.equal(c.init.headers.Authorization, "Bearer tg8_x")
  assert.ok(c.init.headers["Idempotency-Key"])
  assert.equal(c.body.reply_to, "r@acme.in")
  assert.equal(c.body.scheduled_at, "2030-01-01T00:00:00.000Z")
  assert.deepEqual(c.body.attachments[0], { filename: "a.txt", content: "aGVsbG8=", content_type: "text/plain" })
  assert.equal("html" in c.body && !("text" in c.body), true)
})

test("errors come back as { error } and never throw", async () => {
  const fetch = mockFetch([{ status: 429, body: { name: "quota_exceeded", message: "Monthly limit" }, headers: { "retry-after": "3600" } }])
  const mail = new Gr8Mail("tg8_x", { fetch })
  const { data, error } = await mail.emails.send({ from: "a@a.in", to: "b@b.com", subject: "s", text: "t" })
  assert.equal(data, null)
  assert.deepEqual(error, { name: "quota_exceeded", message: "Monthly limit", statusCode: 429, retryAfter: 3600 })
  assert.equal(fetch.calls.length, 1, "quota errors are not retried")
})

test("retries 5xx and short rate limits with the same idempotency key", async () => {
  const fetch = mockFetch([
    { status: 502, body: {} },
    { status: 429, body: { name: "rate_limit_exceeded", message: "slow down" }, headers: { "retry-after": "0" } },
    { body: { id: "ok" } },
  ])
  const mail = new Gr8Mail("tg8_x", { fetch })
  const { data } = await mail.emails.send({ from: "a@a.in", to: "b@b.com", subject: "s", text: "t" })
  assert.deepEqual(data, { id: "ok" })
  assert.equal(fetch.calls.length, 3)
  const keys = new Set(fetch.calls.map((c) => c.init.headers["Idempotency-Key"]))
  assert.equal(keys.size, 1)
})

test("network errors are retried, then reported", async () => {
  const fetch = mockFetch([new TypeError("boom"), new TypeError("boom")])
  const mail = new Gr8Mail("tg8_x", { fetch, maxRetries: 1 })
  const { error } = await mail.domains.list()
  assert.equal(error.name, "network_error")
  assert.equal(fetch.calls.length, 2)
})

test("responses are camelCased", async () => {
  const fetch = mockFetch([{ body: { object: "usage", plan: "Free", limits: { emails_per_day: 100 }, usage: { emails_today: 3 } } }])
  const { data } = await new Gr8Mail("tg8_x", { fetch }).usage.get()
  assert.equal(data.limits.emailsPerDay, 100)
  assert.equal(data.usage.emailsToday, 3)
})

test("contacts use audience paths and snake_case bodies", async () => {
  const fetch = mockFetch([{ status: 201, body: { id: 1, first_name: "Priya" } }, { body: {} }])
  const mail = new Gr8Mail("tg8_x", { fetch, baseUrl: "https://api.test" })
  const { data } = await mail.contacts.create({ audienceId: 7, email: "p@x.com", firstName: "Priya" })
  assert.equal(data.firstName, "Priya")
  assert.equal(fetch.calls[0].url, "https://api.test/audiences/7/contacts")
  assert.deepEqual(fetch.calls[0].body, { email: "p@x.com", first_name: "Priya" })
  await mail.contacts.update({ audienceId: 7, id: "p@x.com", unsubscribed: true })
  assert.equal(fetch.calls[1].url, "https://api.test/audiences/7/contacts/p%40x.com")
  assert.equal(fetch.calls[1].init.method, "PATCH")
})

test("missing key throws a clear error", () => {
  const saved = process.env.GR8MAIL_API_KEY
  delete process.env.GR8MAIL_API_KEY
  assert.throws(() => new Gr8Mail(), /Missing API key/)
  if (saved) process.env.GR8MAIL_API_KEY = saved
})

test("CommonJS build loads", () => {
  const require = createRequire(import.meta.url)
  const cjs = require("../dist/cjs/index.cjs")
  assert.equal(typeof cjs.Gr8Mail, "function")
})

// Live test against a running server: GR8MAIL_TEST_URL=http://127.0.0.1:8000 GR8MAIL_TEST_KEY=tg8_… npm test
test("integration: domains, audiences, contacts, usage", { skip: !process.env.GR8MAIL_TEST_KEY }, async () => {
  const mail = new Gr8Mail(process.env.GR8MAIL_TEST_KEY, { baseUrl: process.env.GR8MAIL_TEST_URL })
  const usage = await mail.usage.get()
  assert.equal(usage.error, null, JSON.stringify(usage.error))
  const aud = await mail.audiences.create({ name: "SDK test" })
  assert.equal(aud.error, null)
  const c = await mail.contacts.create({ audienceId: aud.data.id, email: "sdk@example.com", firstName: "S" })
  assert.equal(c.data.firstName, "S")
  const list = await mail.contacts.list({ audienceId: aud.data.id })
  assert.equal(list.data.data.length, 1)
  assert.equal((await mail.audiences.remove(aud.data.id)).data.deleted, true)
  const bad = await mail.emails.send({ from: "x@not-mine.example", to: "a@b.com", subject: "s", text: "t" })
  assert.equal(bad.error.name, "invalid_from_address")
})
