/**
 * Gr8Mail — official Node.js / TypeScript SDK.
 *
 *   import { Gr8Mail } from "gr8mail"
 *   const mail = new Gr8Mail(process.env.GR8MAIL_API_KEY)
 *   const { data, error } = await mail.emails.send({ from, to, subject, html })
 *
 * Every method resolves to `{ data, error }` and never throws for API errors,
 * so a failed send can't crash a request handler by accident.
 */

export const VERSION = "0.1.0"
const DEFAULT_BASE_URL = "https://mailapi.thegr8labs.com"

// ------------------------------------------------------------------ types
export type ErrorName =
  | "missing_api_key"
  | "invalid_api_key"
  | "restricted_api_key"
  | "validation_error"
  | "missing_required_field"
  | "invalid_from_address"
  | "rate_limit_exceeded"
  | "quota_exceeded"
  | "account_suspended"
  | "plan_limit_reached"
  | "not_found"
  | "domain_exists"
  | "in_use"
  | "concurrent_idempotent_requests"
  | "invalid_idempotent_request"
  | "application_error"
  | "network_error"
  | (string & {})

export interface Gr8MailError {
  name: ErrorName
  message: string
  statusCode: number | null
  /** Seconds to wait before retrying (rate and quota limits). */
  retryAfter?: number
}

export type Result<T> = { data: T; error: null } | { data: null; error: Gr8MailError }

export interface Attachment {
  filename: string
  /** Buffer / Uint8Array / ArrayBuffer, or a base64 string. */
  content: Uint8Array | ArrayBuffer | string
  contentType?: string
}

export interface SendEmailOptions {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string | string[]
  headers?: Record<string, string>
  tags?: { name: string; value: string }[]
  attachments?: Attachment[]
  /** ISO 8601 date or Date. Sends later; cancel with `emails.cancel(id)`. */
  scheduledAt?: string | Date
}

export interface RequestOptions {
  /** Same key + same body within 24h returns the first result instead of sending twice. */
  idempotencyKey?: string
  signal?: AbortSignal
}

export type EmailStatus =
  | "queued" | "scheduled" | "sending" | "sent" | "delivered" | "delivery_delayed" | "opened"
  | "clicked" | "bounced" | "complained" | "failed" | "canceled" | "suppressed"

export interface Email {
  object: "email"
  id: string
  from: string
  to: string[]
  cc: string[] | null
  bcc: string[] | null
  replyTo: string[] | null
  subject: string
  html: string | null
  text: string | null
  lastEvent: EmailStatus
  createdAt: string
  scheduledAt: string | null
  tags: { name: string; value: string }[] | null
}

export interface DnsRecord {
  purpose: "DKIM" | "SPF" | "DMARC" | "Return-Path"
  type: "TXT" | "CNAME" | "MX"
  name: string
  value: string
  status: "pending" | "missing" | "invalid" | "verified"
  required: boolean
}

export interface Domain {
  object: "domain"
  id: number
  name: string
  status: "pending" | "verified" | "failed"
  createdAt: string
  verifiedAt: string | null
  records: DnsRecord[]
}

export interface Audience {
  object: "audience"
  id: number
  name: string
  createdAt: string
}

export interface Contact {
  object: "contact"
  id: number
  email: string
  firstName: string
  lastName: string
  unsubscribed: boolean
  status: "subscribed" | "unsubscribed" | "bounced" | "complained"
  createdAt: string
}

export interface ContactInput {
  email: string
  firstName?: string
  lastName?: string
  unsubscribed?: boolean
}

export interface Limits {
  emailsPerMonth: number
  emailsPerDay: number
  ratePerSecond: number
  maxDomains: number
  maxProjects: number
  maxApiKeys: number
  maxMembers: number
  maxContacts: number
}

export interface Usage {
  object: "usage"
  plan: string
  status: "active" | "suspended"
  /** 0 = unlimited. */
  limits: Limits
  usage: { emailsToday: number; emailsThisMonth: number }
}

export interface ListResponse<T> {
  object: "list"
  data: T[]
  hasMore?: boolean
}

export interface Deleted {
  id: number | string
  deleted: true
}

export interface Gr8MailOptions {
  /** Defaults to https://mailapi.thegr8labs.com (or GR8MAIL_BASE_URL). */
  baseUrl?: string
  /** Retries for network errors, 5xx and per-second rate limits. Default 2. */
  maxRetries?: number
  /** Per-request timeout in ms. Default 30 000. */
  timeout?: number
  /** Custom fetch (tests, proxies). Defaults to globalThis.fetch. */
  fetch?: typeof fetch
}

// --------------------------------------------------------------- helpers
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** snake_case → camelCase keys, except inside free-form maps (headers, limits keep camel). */
function camelize(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => camelize(v))
  if (value && typeof value === "object" && key !== "headers") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelize(v, k)]))
  }
  return value
}

function toBase64(content: Attachment["content"]): string {
  if (typeof content === "string") return content
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer
  if (B) return B.from(bytes).toString("base64")
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function randomKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function emailPayload(o: SendEmailOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from: o.from,
    to: o.to,
    subject: o.subject,
    html: o.html,
    text: o.text,
    cc: o.cc,
    bcc: o.bcc,
    reply_to: o.replyTo,
    headers: o.headers,
    tags: o.tags,
    scheduled_at: o.scheduledAt instanceof Date ? o.scheduledAt.toISOString() : o.scheduledAt,
    attachments: o.attachments?.map((a) => ({ filename: a.filename, content: toBase64(a.content), content_type: a.contentType })),
  }
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
  return body
}

function contactPayload(c: Partial<ContactInput>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ----------------------------------------------------------------- client
export class Gr8Mail {
  readonly emails: Emails
  readonly domains: Domains
  readonly audiences: Audiences
  readonly contacts: Contacts
  readonly usage: UsageResource
  private readonly key: string
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly timeout: number
  private readonly fetchImpl: typeof fetch

  constructor(apiKey?: string, options: Gr8MailOptions = {}) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
    const key = apiKey ?? env.GR8MAIL_API_KEY
    if (!key) throw new Error('Missing API key. Pass it to new Gr8Mail("tg8_…") or set GR8MAIL_API_KEY.')
    this.key = key
    this.baseUrl = (options.baseUrl ?? env.GR8MAIL_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.maxRetries = options.maxRetries ?? 2
    this.timeout = options.timeout ?? 30_000
    const f = options.fetch ?? globalThis.fetch
    if (!f) throw new Error("No fetch available. Use Node 18+ or pass options.fetch.")
    this.fetchImpl = f.bind(globalThis)
    this.emails = new Emails(this)
    this.domains = new Domains(this)
    this.audiences = new Audiences(this)
    this.contacts = new Contacts(this)
    this.usage = new UsageResource(this)
  }

  /** @internal */
  async request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<Result<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      "User-Agent": `gr8mail-node/${VERSION}`,
      Accept: "application/json",
    }
    if (body !== undefined) headers["Content-Type"] = "application/json"
    // POSTs are only retried when an idempotency key makes the retry safe.
    let idem = opts.idempotencyKey
    if (!idem && method === "POST" && path.startsWith("/emails") && this.maxRetries > 0) idem = randomKey()
    if (idem) headers["Idempotency-Key"] = idem
    const payload = body === undefined ? undefined : JSON.stringify(body)

    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), this.timeout)
      const onAbort = () => ctrl.abort()
      opts.signal?.addEventListener("abort", onAbort)
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload, signal: ctrl.signal })
      } catch (err) {
        clearTimeout(timer)
        opts.signal?.removeEventListener("abort", onAbort)
        if (opts.signal?.aborted) return { data: null, error: { name: "network_error", message: "Request aborted.", statusCode: null } }
        if (attempt < this.maxRetries && (method !== "POST" || idem)) {
          await sleep(500 * 2 ** attempt)
          continue
        }
        const message = ctrl.signal.aborted ? `Request timed out after ${this.timeout} ms.` : `Network error: ${(err as Error).message}`
        return { data: null, error: { name: "network_error", message, statusCode: null } }
      }
      clearTimeout(timer)
      opts.signal?.removeEventListener("abort", onAbort)

      const text = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        json = null
      }
      if (res.ok) return { data: camelize(json ?? {}) as T, error: null }

      const name = (json?.name as string) ?? (res.status >= 500 ? "application_error" : "unknown_error")
      const retryAfter = Number(res.headers.get("retry-after")) || undefined
      const transient = res.status >= 500 || (res.status === 429 && name === "rate_limit_exceeded" && (retryAfter ?? 1) <= 10)
      if (transient && attempt < this.maxRetries && (method !== "POST" || idem)) {
        await sleep(retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt)
        continue
      }
      return {
        data: null,
        error: {
          name,
          message: (json?.message as string) ?? (json?.detail as string) ?? `Request failed with status ${res.status}.`,
          statusCode: res.status,
          ...(retryAfter ? { retryAfter } : {}),
        },
      }
    }
  }
}

class Resource {
  constructor(protected readonly client: Gr8Mail) {}
}

class Emails extends Resource {
  /** Send one email (up to 50 recipients across to/cc/bcc). */
  send(email: SendEmailOptions, opts?: RequestOptions) {
    return this.client.request<{ id: string }>("POST", "/emails", emailPayload(email), opts)
  }

  /** Send up to 100 emails in one request. All are validated before any is sent. */
  batch(emails: SendEmailOptions[], opts?: RequestOptions) {
    return this.client.request<{ data: { id: string }[] }>("POST", "/emails/batch", emails.map(emailPayload), opts)
  }

  /** Look up an email and its latest status. Needs a full-access key. */
  get(id: string) {
    return this.client.request<Email>("GET", `/emails/${encodeURIComponent(id)}`)
  }

  /** Cancel a scheduled email that hasn't gone out yet. */
  cancel(id: string) {
    return this.client.request<{ object: "email"; id: string }>("POST", `/emails/${encodeURIComponent(id)}/cancel`)
  }
}

class Domains extends Resource {
  list() {
    return this.client.request<ListResponse<Domain>>("GET", "/domains")
  }
  /** Add a domain. The response lists the DNS records to publish. */
  create(params: { name: string }) {
    return this.client.request<Domain>("POST", "/domains", params)
  }
  get(id: number) {
    return this.client.request<Domain>("GET", `/domains/${id}`)
  }
  /** Re-check DNS now (it is also re-checked automatically every 10 minutes). */
  verify(id: number) {
    return this.client.request<Domain>("POST", `/domains/${id}/verify`)
  }
  remove(id: number) {
    return this.client.request<Deleted>("DELETE", `/domains/${id}`)
  }
}

class Audiences extends Resource {
  list() {
    return this.client.request<ListResponse<Audience>>("GET", "/audiences")
  }
  create(params: { name: string }) {
    return this.client.request<Audience>("POST", "/audiences", params)
  }
  get(id: number) {
    return this.client.request<Audience>("GET", `/audiences/${id}`)
  }
  remove(id: number) {
    return this.client.request<Deleted>("DELETE", `/audiences/${id}`)
  }
}

class Contacts extends Resource {
  /** Add a contact, or update it if the email is already in the audience. */
  create(params: ContactInput & { audienceId: number }) {
    const { audienceId, ...rest } = params
    return this.client.request<Contact>("POST", `/audiences/${audienceId}/contacts`, contactPayload(rest))
  }
  list(params: { audienceId: number; limit?: number; offset?: number }) {
    const q = new URLSearchParams()
    if (params.limit) q.set("limit", String(params.limit))
    if (params.offset) q.set("offset", String(params.offset))
    const qs = q.toString() ? `?${q}` : ""
    return this.client.request<ListResponse<Contact>>("GET", `/audiences/${params.audienceId}/contacts${qs}`)
  }
  /** `id` may be the contact id or its email address. */
  get(params: { audienceId: number; id: number | string }) {
    return this.client.request<Contact>("GET", `/audiences/${params.audienceId}/contacts/${encodeURIComponent(String(params.id))}`)
  }
  update(params: Partial<Omit<ContactInput, "email">> & { audienceId: number; id: number | string }) {
    const { audienceId, id, ...rest } = params
    return this.client.request<Contact>("PATCH", `/audiences/${audienceId}/contacts/${encodeURIComponent(String(id))}`, contactPayload(rest))
  }
  remove(params: { audienceId: number; id: number | string }) {
    return this.client.request<Deleted>("DELETE", `/audiences/${params.audienceId}/contacts/${encodeURIComponent(String(params.id))}`)
  }
}

class UsageResource extends Resource {
  /** Your plan, its limits and what you've sent today / this month. */
  get() {
    return this.client.request<Usage>("GET", "/usage")
  }
}

export default Gr8Mail
