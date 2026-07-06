# Ninja Translate

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/SeanZoR/ninja-translate/actions/workflows/ci.yml/badge.svg)](https://github.com/SeanZoR/ninja-translate/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A WhatsApp bot that lives in groups and translates voice notes and `@mentioned`
text into every other language configured for that group. Powered by
Gemini 2.5 Flash for native-audio understanding in one round trip.

> **Status:** early but functional. Used in production by the maintainer.
> Self-host friendly — see [Quick start](#quick-start). See
> [`ROADMAP.md`](ROADMAP.md) for what's next.

> ⚠️ **Unofficial WhatsApp client.** This project uses
> [Baileys](https://github.com/WhiskeySockets/Baileys), the same library
> behind many community WhatsApp bots. It is **not** an official Meta /
> WhatsApp product and is not endorsed by them. Running it on an account
> may violate WhatsApp's Terms of Service and could result in that account
> being banned. **Use at your own risk on a dedicated number you can afford
> to lose.** See [Disclaimer](#disclaimer) for the longer version.

---

## Features

- 🎙 **Voice translation** — native audio in, translations out, one Gemini call
- 💬 **Text translation on `@mention`** — no spam in active chats
- 🌐 **N-language fan-out per group** — any ISO code Gemini supports
- 🧹 **Polish levels (0–3)** — verbatim → cleaned-up → rewrite-for-clarity
- 👤 **Per-user overrides** — speakers DM the bot for a magic link to a
  personal settings page (polish, tone, language hint, etc.) that overrides
  the group config for their own messages
- 👑 **Group self-service for WhatsApp admins** — mention the bot with the
  word `language` in a group and, if you're a group admin, it DMs you a magic
  link to that group's settings page (languages, voice/text toggles, polish).
  Adminship is re-verified live on every API call
- 💰 **Pre-flight cost guard** — skip oversize audio before paying for it
- 📉 **Monthly budget cap per group** — soft pause when exceeded, resume on bump
- 🔐 **Cloudflare Access-gated admin dashboard** — JWT verified server-side
- 📊 **Per-group history + cost tracking** — SQLite, no extra services
- 💾 **Nightly R2 backups** — DB + WhatsApp session + recent audio
- 🪶 **Lightweight** — single Node process, ~150MB RAM idle

## How it works

```
WhatsApp group ──► Baileys ──► Gemini 2.5 Flash ──► reply rendered into the group
                       │              │
                       ▼              ▼
                    SQLite       cost + tokens
```

A voice note arrives, Baileys hands it off to the translator, Gemini detects
the source language and emits translations for every other configured language,
and the bot posts a single rendered reply quoting the original message. Text
mentions follow the same path with no audio step.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the deeper dive.

## Quick start

### Prerequisites

- Node ≥ 20, [pnpm](https://pnpm.io/) ≥ 9
- A [Google AI Studio](https://aistudio.google.com/app/apikey) key for Gemini
- A WhatsApp account dedicated to the bot (you'll pair it via QR on first run)

### Install + run locally

```bash
git clone https://github.com/SeanZoR/ninja-translate.git
cd ninja-translate
pnpm install
pnpm rebuild better-sqlite3        # native module

cp .env.example .env               # fill in GEMINI_API_KEY at minimum

# 1. One-time WhatsApp pairing — scan the QR with the bot's WhatsApp.
pnpm login

# 2. Capture the BOT_JID printed at the end of pairing and paste it into .env.

# 3. Start the bot + admin API.
pnpm dev
# admin API on http://127.0.0.1:7878

# (Alternative) admin-only mode — no WhatsApp client, just the API + Playground.
pnpm dev:admin
```

Open the dashboard locally: serve the `web/` directory on any static server
(e.g. `python3 -m http.server 5173` from inside `web/`) and temporarily edit
`web/index.html` to set `<meta name="api-base" content="http://127.0.0.1:7878">`.

The **Playground** tab lets you exercise the translator end-to-end without
ever sending a WhatsApp message — handy for tuning languages and polish
levels before approving a real group.

## Configuration

All configuration is via environment variables. The app reads from
`process.env`, so any approach works: a plain `.env` file, Doppler, 1Password
CLI, AWS SSM, etc. See [`.env.example`](.env.example) for the full list.

| Var | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google AI Studio key for the translator. |
| `GEMINI_MODEL` |  | Defaults to `gemini-2.5-flash`. |
| `BOT_JID` | after pairing | Captured by `pnpm login`. Paste it here so the bot starts cleanly. |
| `ADMIN_HOST` |  | Defaults to `127.0.0.1`. Keep on loopback in production. |
| `ADMIN_PORT` |  | Defaults to `7878`. |
| `API_ALLOWED_ORIGINS` |  | Comma-separated dashboard origins for CORS. |
| `PUBLIC_USER_BASE_URL` | for per-user prod | Public hostname for the magic-link settings page (e.g. `https://u.translate.<domain>`). Must NOT be behind CF Access. |
| `CF_ACCESS_TEAM_DOMAIN` | for prod gate | e.g. `your-team.cloudflareaccess.com`. |
| `CF_ACCESS_AUD` | for prod gate | AUD tag from the CF Access app. When unset, the JWT middleware bypasses (local-dev path). |
| `NINJA_HOME` |  | Override the data directory (default `~/.ninja-translate`). |
| `R2_*` | for backups | Cloudflare R2 creds for `pnpm backup`. |
| `TRANSLATOR_FALLBACK` |  | `true` to enable the ElevenLabs+Anthropic path for low-resource languages (Burmese specifically). |
| `ELEVENLABS_API_KEY` | with fallback | Required when `TRANSLATOR_FALLBACK=true`. |
| `ANTHROPIC_API_KEY` | with fallback | Required when `TRANSLATOR_FALLBACK=true`. |
| `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_CHAT_ID` |  | Optional fatal-error alerts. |

## Deploy

The recommended production layout: a small Linux VPS for the bot + admin API,
Cloudflare Tunnel for the API hostname, Cloudflare Pages for the dashboard,
and a single Cloudflare Access app gating both subdomains.

```
Cloudflare                                Linux VPS
├── Pages: translate.<your-domain>        ├── Baileys (WhatsApp)
│   (static dashboard - web/)             ├── Gemini 2.5 Flash (translate)
│                                         ├── SQLite (per-group history + cost)
└── Tunnel: api.translate.<your-domain> ─►└── Hono admin API (127.0.0.1:7878)
    (CF Access gates both)
```

### VPS bootstrap

```bash
ssh root@<your-vps>
bash <(curl -fsSL https://raw.githubusercontent.com/SeanZoR/ninja-translate/main/deploy/install.sh)
# follow the printed steps
```

The script installs Node 22, `cloudflared`, creates a `ninja` user, clones
the repo into `/opt/ninja-translate`, and prints next steps for env, pairing,
and the systemd unit.

### Dashboard (Cloudflare Pages)

```bash
API_BASE=https://api.translate.your-domain.com ./scripts/build-web.sh
wrangler pages deploy web-dist --project-name=ninja-translate-dashboard
```

### Per-user & group settings pages (public hostname)

The magic-link pages (`/u/:token` for personal settings, `/g/:token` for
group-admin settings) and their APIs (`/api/u/...`, `/api/g/...`)
must be reachable WITHOUT CF Access — the token in the URL is the auth
(group pages additionally re-verify WhatsApp adminship server-side).
Add a second CF Tunnel hostname pointing to the same `127.0.0.1:7878` Hono
process, e.g. `u.translate.<your-domain>`, and **do not** include it in the
CF Access app from the next section. Set `PUBLIC_USER_BASE_URL=https://u.translate.<your-domain>`
in the bot's env so DM auto-replies link to the right hostname.

The onboarding video on that page is rendered locally and committed to
`web/assets/videos/how-to.mp4` via `pnpm video:render` before each deploy.
Both `web/assets/videos/` and `remotion/out/` are gitignored.

### Cloudflare Access

Create one app covering both `translate.your-domain.com` and
`api.translate.your-domain.com`, allowlist your email, set the SSO session
to 24h. Set the API's `CF_ACCESS_AUD` to the AUD tag from that app and
`CF_ACCESS_TEAM_DOMAIN` to your `<team>.cloudflareaccess.com`.

Without `CF_ACCESS_AUD`, the JWT middleware is bypassed entirely — fine for
local dev, **not OK for production**.

## Development

```bash
pnpm dev               # full stack: WhatsApp client + admin API
pnpm dev:admin         # admin API only (no WhatsApp pairing required)
pnpm typecheck         # tsc --noEmit
pnpm lint              # ESLint
pnpm lint:fix          # ESLint with autofix
pnpm format            # Prettier write
pnpm format:check      # Prettier check
pnpm build             # tsc -p tsconfig.json
pnpm login             # one-time WhatsApp QR pairing
pnpm backup            # tarball DB+session+recent audio → R2
```

Verification runbook (Layer 1 → 2 → 3):
[`docs/verification.md`](docs/verification.md).

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) — priorities-only, no dates.

## Contributing

PRs welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening one.
We use [Conventional Commits](https://www.conventionalcommits.org/), and the
PR template will walk you through the rest.

By contributing, you agree your changes are licensed under the MIT License.

## Security

Found a vulnerability? Please report privately — see [`SECURITY.md`](SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Disclaimer

Ninja Translate is an independent, unofficial project. It is not affiliated
with, authorized by, endorsed by, or in any way officially connected to
WhatsApp, Meta Platforms, or any of their subsidiaries.

The bot connects to WhatsApp through the open-source
[Baileys](https://github.com/WhiskeySockets/Baileys) library, the same
approach used by many popular community WhatsApp bots and tooling projects.
That kind of unofficial client access **may violate WhatsApp's
[Terms of Service](https://www.whatsapp.com/legal/terms-of-service)** and
the account running the bot can be **rate-limited, restricted, or banned**
at WhatsApp's discretion, with no warning and no recourse.

By choosing to self-host or run this software, you acknowledge that:

- You are doing so **at your own risk and on your own responsibility**.
- You should run it on a **dedicated WhatsApp number** that you are willing
  to lose.
- You are responsible for **complying with applicable laws** in your
  jurisdiction (including privacy/recording consent laws — voice notes are
  sent to a third-party translation API).
- You are responsible for **getting consent** from group participants where
  required before deploying the bot in their conversations.
- The maintainers and contributors provide this software **"as is"** with
  no warranty (see the [LICENSE](LICENSE)) and accept no liability for
  account bans, data loss, regulatory issues, or any other consequences of
  use.

If you are not comfortable with these terms, **do not run this software**.

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

- [Baileys](https://github.com/WhiskeySockets/Baileys) — the open-source
  WhatsApp Web protocol implementation that makes this whole thing possible.
- [Gemini](https://ai.google.dev/) — native-audio understanding in a single
  call is what made the latency budget work.
- [Hono](https://hono.dev/) — the admin API framework.
- [Alpine.js](https://alpinejs.dev/) — the dashboard's only frontend dependency.
