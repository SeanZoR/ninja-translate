# Contributing to Ninja Translate

Thanks for considering a contribution. This guide covers the practical bits.

## Quick start (development)

```bash
git clone https://github.com/<your-fork>/ninja-translate.git
cd ninja-translate
pnpm install
pnpm rebuild better-sqlite3   # native module

cp .env.example .env          # fill in real values for at least GEMINI_API_KEY
pnpm dev                      # full stack: WhatsApp client + admin API
# or
pnpm dev:admin                # admin API + Playground only (no WhatsApp pairing needed)
```

The admin API runs on `http://127.0.0.1:7878`. To use the dashboard locally,
serve `web/` on a static server and point its `<meta name="api-base">` at the
admin URL — see the README's "Development" section.

## Before opening a PR

```bash
pnpm typecheck
pnpm lint
pnpm build
```

All three must pass. CI runs the same checks.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/). The
existing log is the source of truth; common prefixes:

- `feat:` — new functionality
- `fix:` — bug fix
- `chore:` — tooling, deps, config
- `docs:` — documentation only
- `refactor:` — internal change with no behavior difference
- `ui:` — dashboard / `web/` changes
- A scope is fine but optional: `fix(wa): ...`, `feat(translator): ...`

Keep commit subjects ≤ 72 chars and explain the *why* in the body when
non-obvious.

## Branch + PR workflow

1. Branch off `main`: `git checkout -b feat/short-description`.
2. Make focused commits. Squash if the history gets noisy.
3. Open a PR against `main` filling in the PR template.
4. Tag `@<maintainer>` if review hasn't started after 3 business days.

## Code style

- TypeScript, ES modules (`"type": "module"`).
- ESLint + Prettier are the source of truth — run `pnpm lint --fix` and
  `pnpm format` before committing.
- Single quotes, semicolons, 100-char line width, ES5 trailing commas.
- Prefer named exports over default exports.
- Don't add comments that just restate what the code does. Add one only when
  the *why* is non-obvious.

## Testing

There is no test suite yet. Until one lands, the
[`docs/verification.md`](docs/verification.md) runbook is the
end-to-end test plan: Layer 1 (Playground), Layer 2 (admin API), Layer 3
(live WhatsApp). At minimum, run Layer 1 against the Playground tab to verify
your change before requesting review.

If your change touches the WhatsApp wire format or DB schema, run Layer 3 in
your own test group before requesting review.

Adding tests (unit or integration) is welcome — see
[`ROADMAP.md`](ROADMAP.md) and feel free to propose a framework.

## What to work on

- Open issues labeled `good first issue` are scoped to be a gentle entry.
- The [`ROADMAP.md`](ROADMAP.md) buckets (`Now` / `Next` / `Later`) reflect
  rough priority. Pick something from `Next` or `Later` and ask in an issue
  before starting if it's non-trivial.
- New features are welcome but please open an issue first to align on scope.

## Reporting bugs

Use the **Bug report** issue template. Include:

- Versions: Node, package version (`git rev-parse --short HEAD`)
- Steps to reproduce
- Expected vs actual
- Relevant logs (`journalctl -u ninja-translate` on a VPS, console output in
  dev). **Redact any group JIDs, phone numbers, or API keys before posting.**

## Reporting security issues

See [`SECURITY.md`](SECURITY.md). Don't open public issues for vulnerabilities.

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE) as the rest of the project.
