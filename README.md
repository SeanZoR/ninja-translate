# Ninja Translate

WhatsApp bot that lives in groups and translates voice + @mentioned text into every other language configured for that group.

## Architecture

```
Cloudflare                                Hostinger VPS
├── Pages: translate.your-domain.com            ├── Baileys (WhatsApp)
│   (static dashboard - web/)             ├── Gemini 2.5 Flash (translate)
│                                         ├── SQLite (per-group history + cost)
└── Tunnel: api.translate.your-domain.com  ───► └── Hono admin API (127.0.0.1:7878)
    (CF Access gates both)
```

Both subdomains sit behind one Cloudflare Access app (Sean's Google login). The CF
Access JWT cookie is verified server-side by the API on every request.

## Languages (day 1)

Thai (`th`), English (`en`), Hebrew (`he`), Burmese (`my`). More are a config row
change - add the ISO code to a group's `target_languages`.

## Local development

```bash
pnpm install
pnpm rebuild better-sqlite3

# 1. Pair the WhatsApp account (one-time)
doppler run -- pnpm login   # prints BOT_JID; save it to Doppler

# 2. Run everything
doppler run -- pnpm dev
# admin API on http://127.0.0.1:7878 (no CF Access locally - bypassed when CF_ACCESS_AUD is unset)

# 3. Serve the dashboard locally pointing at the local API
cd web && python3 -m http.server 5173
# open http://127.0.0.1:5173 - the meta api-base="" makes it use same-origin,
# so you'll need to either reverse-proxy or set api-base manually for dev.
```

## Deploy

### VPS

```bash
ssh root@<hostinger-vps>
bash <(curl -fsSL https://raw.githubusercontent.com/SeanZoR/ninja-translate/main/deploy/install.sh)
# follow the printed steps
```

### Dashboard (Cloudflare Pages)

```bash
API_BASE=https://api.translate.your-domain.com ./scripts/build-web.sh
wrangler pages deploy web-dist --project-name=ninja-translate-dashboard
```

### CF Access

Create one app covering both `translate.your-domain.com` and `api.translate.your-domain.com`,
allowlist Sean's Google email, single-sign-on session 24h. Set the API's
`CF_ACCESS_AUD` to the AUD tag from that app and `CF_ACCESS_TEAM_DOMAIN` to your
team's `*.cloudflareaccess.com` hostname.

## Doppler config (`your-project/prd`)

| Var | Notes |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key |
| `BOT_JID` | Captured after first WA QR pairing |
| `CF_ACCESS_TEAM_DOMAIN` | e.g. `your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | AUD tag from the API CF Access app |
| `API_ALLOWED_ORIGINS` | `https://translate.your-domain.com` |
| `DB_PATH`, `AUDIO_DIR`, `SESSION_DIR` | Optional overrides |
| `R2_*` | Nightly backups |
| `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY` | Only if Burmese fallback activated |

## Testing the flow

1. Add `+15551234567` to a fresh test group on a friend's phone.
2. Bot stays silent. Group appears in dashboard **Inbox** within ~5s.
3. **Approve** with `target_languages: ["en", "th"]`.
4. Send a Thai voice note in the group → bot replies with English translation.
5. Send `@bot hello` → bot replies with Thai translation.
6. Open **Cost** tab → verify ¢0.0x charged.
