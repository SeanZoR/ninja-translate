# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Instead,
please report them privately so we can fix the issue before it's public.

Email: **sean.katz@gmail.com** with subject prefix `[ninja-translate security]`.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept welcome)
- Affected versions, if known
- Any suggested fix

We aim to acknowledge reports within **3 business days** and provide an initial
assessment within **7 business days**. Once a fix lands, we'll credit you in
the release notes (unless you prefer to remain anonymous).

## Scope

This project handles WhatsApp messages, audio, and a per-group SQLite store.
Particularly interested in reports about:

- Authentication bypass on the admin API (Cloudflare Access JWT verification)
- WhatsApp session-data exfiltration (the `wa-session/` directory contains
  Baileys credentials — anyone with these can impersonate the bot account)
- API-key leakage (Gemini, ElevenLabs, Anthropic, R2)
- Path traversal in audio storage (`src/wa/client.ts` — `audioPath`)
- SQL injection / unsafe SQL in `src/db/`
- Prompt injection that causes the translator to do something unexpected

Out of scope: rate-limiting on the admin API (it's not exposed publicly when
Cloudflare Access is enabled), DoS that requires owning the WhatsApp account.

## Supported Versions

Only the latest release on `main` is supported. Older tags are not patched.

## A note on WhatsApp ToS

Ninja Translate uses [Baileys](https://github.com/WhiskeySockets/Baileys), an
unofficial WhatsApp Web client. Running the bot **may violate WhatsApp's
Terms of Service** and the account running it can be banned at any time. This
is the same risk profile as any community Baileys-based project. The maintainers
do not condone or recommend evading WhatsApp's policies — by self-hosting you
accept that risk yourself. See the [Disclaimer](README.md#disclaimer) in the
README for the full terms.
