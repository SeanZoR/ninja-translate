# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Group self-service settings for WhatsApp group admins: mention the bot
  with the word `language` (or `settings`) in a group to get a magic link
  (`/g/:token`) to that group's settings page — target languages,
  voice/text toggles, polish level, reply formatting. Only WhatsApp
  admins/superadmins of the group can request a link, and adminship is
  re-verified against live group metadata on every API call, so demoted
  admins lose access within a minute. DM auto-replies now also list
  group-settings links for every group where the sender is an admin.
  Cost/safety controls (enabled, budget, max audio length) remain
  dashboard-only.

- Open-source repository scaffolding: `LICENSE` (MIT), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `ROADMAP.md`, `ARCHITECTURE.md`,
  GitHub issue/PR templates, Dependabot, and CI workflow.
- ESLint + Prettier configuration with `lint`, `lint:fix`, `format`,
  `format:check` scripts.
- `.env.example` documenting every supported env var as the primary
  configuration path (replaces the Doppler-only setup in earlier docs).

### Changed

- README rewritten: badges, generic deploy guidance, configuration table,
  contributing pointers. No longer assumes the maintainer's personal
  infrastructure.
- `VERIFICATION.md` moved to `docs/verification.md`.
- Deploy assets (`deploy/install.sh`, `deploy/cloudflared.yml`,
  `deploy/ninja-translate.service`) generalized with placeholders so any
  user can self-host.

### Security

- Personal phone numbers, domains, and infrastructure references scrubbed
  from the codebase and git history (no API keys or secrets were ever
  committed; the audit confirmed only personal-info exposure).

## [0.1.0] — 2026-04-30

Initial scaffold. Functional WhatsApp translation bot with admin dashboard.

### Added

- WhatsApp client via Baileys 7.0.0-rc.9 with single-socket reconnect loop.
- Voice translation through Gemini 2.5 Flash native audio.
- Text translation on `@mention` (matches against bot LID, not just JID).
- N-language fan-out per group (any ISO code Gemini supports).
- Per-group polish level (0–3) replacing the earlier `concise_mode` boolean.
- Source-line flag emoji rendering; source line omitted on text mentions.
- Pre-flight cost guard (`max_audio_seconds`, default 600s / 10 min).
- Per-group monthly budget cap with reaction-only response when exceeded.
- Admin Hono API on `127.0.0.1:7878`, Cloudflare Access JWT verification.
- Static dashboard (`web/`) — Inbox, Groups, Playground, Cost, System tabs.
- Open-mode feature flag (off by default; auto-approves new groups when on).
- SQLite persistence: groups, pending_groups, rejected_groups, messages,
  usage_daily.
- R2 nightly backup script (`pnpm backup`) with 7-day audio retention.
- Cloudflare Tunnel + Pages deploy assets.
- Rejection + re-add lockout (`rejected_groups` table prevents re-prompting).

[Unreleased]: https://github.com/<your-github>/ninja-translate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<your-github>/ninja-translate/releases/tag/v0.1.0
