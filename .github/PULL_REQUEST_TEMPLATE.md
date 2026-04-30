<!--
Thanks for the contribution. Filling this in helps reviewers move fast.
Delete sections that don't apply.
-->

## What

<!-- One or two sentences. What does this PR do? -->

## Why

<!-- Motivation. Link the issue if there is one: "Closes #123". -->

## How tested

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Ran the relevant layer(s) of `docs/verification.md`:
  - [ ] Layer 1 — Playground
  - [ ] Layer 2 — Local Hono integration
  - [ ] Layer 3 — Live WhatsApp smoke test
- [ ] Manual verification (describe below)

<!-- Steps a reviewer can run to verify locally. -->

## Screenshots / logs

<!-- Drag in screenshots for UI changes; paste log snippets for behavior changes. -->

## Notes for the reviewer

<!-- Anything non-obvious: tradeoffs taken, alternatives considered, follow-ups. -->

## Checklist

- [ ] Commit messages follow Conventional Commits (`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `ui:`).
- [ ] No secrets, real phone numbers, or real group JIDs in code, logs, or screenshots.
- [ ] Updated `CHANGELOG.md` under `[Unreleased]` if this is user-visible.
- [ ] Updated `ROADMAP.md` (moved item to `Shipped`) if this completes a tracked item.
- [ ] Docs updated (README, ARCHITECTURE.md, .env.example) if behavior changed.
