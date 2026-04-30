# Roadmap

Lite tracker — priorities only, no dates. Items move bucket-to-bucket as they
get worked. `Now` is capped at 3 to keep focus.

## Now (P0)

Working on this. Cap: 3 items.

<!-- add items here -->

## Next (P1)

Up next when `Now` empties out.

<!-- add items here -->

## Later (P2)

Wanted, not urgent. Reshufflable.

<!-- add items here -->

## Ideas

Unsorted. Promote to `Later` / `Next` when worth committing to.

<!-- add items here -->

## Shipped

Recent wins. Trim when this gets long.

- 0.1.0 scaffold — voice + text translation, admin dashboard, CF Access gate, SQLite history, R2 backups
- Polish-level (0–3) replaces concise_mode bool
- Flag emoji on source line; no source line on text @mentions
- `max_audio_seconds` default raised to 600 (10 min)
- WhatsApp `@mention` matching against bot LID
- Single-socket WhatsApp reconnect loop (kills 440 ping-pong)
- Baileys 7.0.0-rc.9 + `fetchLatestBaileysVersion`
- Language multi-select picker
- Cloudflare Tunnel + Pages deploy wired
- Open-mode feature flag (off by default)
- Playground tab + verification runbook
