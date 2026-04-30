# Architecture

A deeper dive than the README. Read this before contributing non-trivial
changes.

## High-level diagram

```
┌────────────────────────────┐         ┌──────────────────────────────────┐
│  Cloudflare                │         │  Linux VPS                       │
│                            │         │                                  │
│  Pages: translate.<dom>    │  HTTPS  │  ┌────────────────────────────┐  │
│  (static dashboard, web/)  │ ──────► │  │  cloudflared (tunnel)      │  │
│                            │         │  └────────────┬───────────────┘  │
│  Tunnel + Access:          │         │               │                  │
│  api.translate.<dom>       │ ──────► │  127.0.0.1:7878                  │
│  (CF Access JWT gate)      │         │  ┌────────────▼───────────────┐  │
└────────────────────────────┘         │  │  Hono admin API            │  │
                                       │  │  (src/api/)                │  │
                                       │  │   • /api/groups            │  │
                                       │  │   • /api/inbox             │  │
                                       │  │   • /api/playground/...    │  │
                                       │  │   • /api/usage             │  │
                                       │  │   • /api/messages/...      │  │
                                       │  │   • /api/system/...        │  │
                                       │  └────────────┬───────────────┘  │
                                       │               │                  │
                                       │  ┌────────────▼───────────────┐  │
                                       │  │  better-sqlite3            │  │
                                       │  │  ~/.ninja-translate/data.db│  │
                                       │  └────────────────────────────┘  │
                                       │                                  │
                                       │  ┌────────────────────────────┐  │
                                       │  │  WhatsApp client (Baileys) │  │
                                       │  │  src/wa/                   │  │
                                       │  │   • client.ts (socket)     │  │
                                       │  │   • handler.ts (dispatch)  │  │
                                       │  │   • groups.ts (lifecycle)  │  │
                                       │  └────────────┬───────────────┘  │
                                       │               │                  │
                                       │  ┌────────────▼───────────────┐  │
                                       │  │  Translator                │  │
                                       │  │  src/translator/gemini.ts  │  │
                                       │  │   → Gemini 2.5 Flash       │  │
                                       │  └────────────────────────────┘  │
                                       │                                  │
                                       │  Nightly: pnpm backup → R2       │
                                       └──────────────────────────────────┘
```

## Data flow: a voice note arriving in an allowlisted group

1. **Baileys** receives the WhatsApp event in `src/wa/client.ts`. The
   `messages.upsert` handler calls `handleMessage` (`src/wa/handler.ts`).
2. The handler looks up the group in SQLite. If not in `groups`, falls back
   to the open-mode flag (`settings` table) or inserts into `pending_groups`
   and returns silently.
3. If the group is enabled and `voice_translate` is true, the handler:
   a. **Pre-flight cost guard**: rejects if audio > `max_audio_seconds`
      (reacts ⏱ on the source message).
   b. **Budget check**: if month-to-date cost ≥ `monthly_budget_cents`,
      reacts 💸 and returns.
   c. Downloads audio via Baileys, writes to `~/.ninja-translate/audio/<jid>/`.
4. **Translator** (`src/translator/gemini.ts`) sends the audio to Gemini 2.5
   Flash with a prompt that requests JSON: source language detection +
   translation into every other configured language. The polish level (0–3)
   shapes the source-line cleanup.
5. The handler **renders the reply** (flag emojis, optional source label),
   sends it back to the group quoting the original message, then writes a
   row to `messages` and updates `usage_daily`.

Text mentions take a similar path but skip download, audio storage, and
polish — they go straight from the WhatsApp text body into the translator.

## Modules

### `src/wa/`

- `client.ts` — Baileys socket lifecycle. Single socket at a time; reconnects
  serially after disconnect. Holds `botJid` (phone-form) and `botLid`
  (LID-form, used for `@mention` matching in modern WhatsApp). Important: the
  ping-pong "stream replaced" 440 disconnect was caused by overlapping sockets
  sharing one auth state — fixed by awaiting `connection.update.close` before
  starting the next iteration.
- `handler.ts` — message dispatch, cost guards, translator invocation, reply
  rendering, persistence.
- `groups.ts` — joining, leaving, regenerating invite links.

### `src/translator/`

- `gemini.ts` — calls `@google/generative-ai`. Single function returns
  `{ sourceLang, sourceText, translations, tokensIn, tokensOut, costCents }`.
  Prompt is parameterized over polish level and target-language list. Cost
  is computed locally from token counts (no Gemini-side billing readback).
  Fallback path (ElevenLabs Scribe + Anthropic) is implemented but disabled
  by default — flip `TRANSLATOR_FALLBACK=true` and set `ELEVENLABS_API_KEY` /
  `ANTHROPIC_API_KEY` to enable for Burmese-quality scenarios.

### `src/api/`

- `index.ts` — Hono server, CORS, mounts routes.
- `cf-access.ts` — middleware. Verifies the `Cf-Access-Jwt-Assertion` header
  (or `CF_Authorization` cookie) against the team's JWKS and the configured
  AUD tag. **Bypassed entirely when `CF_ACCESS_AUD` is unset** — that's the
  local-dev path.
- `routes/groups.ts` — CRUD for the `groups` table.
- `routes/inbox.ts` — list pending, approve (move row to `groups`), reject
  (move to `rejected_groups`, leave the WA group).
- `routes/messages.ts` — per-group history queries.
- `routes/usage.ts` — month-to-date cost rollup per group.
- `routes/playground.ts` — the dashboard's Playground tab. Hits the
  translator without persisting or sending anything to WhatsApp.
- `routes/system.ts` — botJid, server time, open-mode read/write.

### `src/db/`

- `index.ts` — `better-sqlite3` instance, schema bootstrap, prepared
  statement helpers.
- `schema.sql` — table definitions. Five tables + one rollup (see below).

### `web/`

Static Alpine.js dashboard. No build step in dev (served directly). For
production deploy via Cloudflare Pages, `scripts/build-web.sh` substitutes
the `<meta name="api-base">` with the public API origin and emits `web-dist/`.

## Database schema

| Table             | Purpose                                                              |
|-------------------|----------------------------------------------------------------------|
| `groups`          | Allowlisted groups. One row per WhatsApp group the bot serves.       |
| `pending_groups`  | Groups the bot was added to but the maintainer hasn't decided on.    |
| `rejected_groups` | Groups the maintainer said no to. Re-adds are silently dropped.      |
| `messages`        | Every translated message — source, translations, tokens, cost.       |
| `usage_daily`     | Per-group, per-day rollup for the Cost tab.                          |
| `settings`        | Global key/value (currently just the open-mode flag).                |

See `src/db/schema.sql` for the authoritative definition.

## Design decisions

- **Why Baileys**: WhatsApp Web protocol is the only reasonable path for a
  group-level bot without a Business API account. Baileys is the most
  actively-maintained open-source implementation and supports both phone-JID
  and LID identity, which became necessary when WhatsApp rolled out LIDs
  for `@mention` resolution.
- **Why a single socket at a time**: stacking sockets on shared auth state
  triggers the "stream replaced" (440) disconnect loop. The cleanest fix is
  serial reconnects.
- **Why Gemini 2.5 Flash for voice**: native audio in / text out in one call
  (no separate ASR step), and pricing is competitive. The fallback path
  (ElevenLabs Scribe + Anthropic) exists for low-resource languages where
  Gemini's audio understanding is shaky — Burmese specifically.
- **Why SQLite**: zero-ops, single-file, plenty fast for the bot's volume
  (well under 1k messages/day across all groups). `better-sqlite3` gives a
  synchronous API which simplifies the hot path.
- **Why Hono + a separate static dashboard**: the bot process needs to handle
  WhatsApp messages with low latency; serving HTML from the same process is
  fine but mixing concerns. Splitting the dashboard out to Cloudflare Pages
  lets the API live behind Cloudflare Access and the dashboard inherit the
  same SSO session.
- **Why Cloudflare Access**: free SSO gate for the admin API. JWT verification
  is offline-able (JWKS) so the API has no runtime dependency on Cloudflare's
  control plane.
- **Why Cloudflare Tunnel** (vs. opening a port on the VPS): no inbound
  firewall rules, mTLS to Cloudflare's edge, free.

## Observability

- Stdout / stderr — `journalctl -u ninja-translate -f` on a VPS.
- The `[wa]`, `[handler]`, `[main]` log prefixes are intentional; grep on
  them when debugging.
- Cost is computed and persisted on every message, so usage drift is
  observable in the dashboard's Cost tab without separate metrics.
- Telegram alerts (`src/alerts.ts`) — optional. If `TELEGRAM_BOT_TOKEN` and
  `ADMIN_TELEGRAM_CHAT_ID` are set, fatal errors fan out there.

## Backups

`pnpm backup` (`scripts/backup.ts`) tarballs `data.db` + `wa-session/` (and
last 7 days of audio) and uploads to Cloudflare R2. Schedule via cron on
the VPS — see the script's header. Losing `wa-session/` forces a re-pair, so
this matters more than the DB for keeping the bot online.
