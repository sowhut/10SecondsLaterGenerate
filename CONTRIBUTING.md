# Contributing

Thanks for your interest in the **10 Seconds Later** open-source level editor!

This repository is the **public Web editor monorepo**. Keep changes focused on the public
level format, browser editor, project homepage, examples, or contributor-facing documentation.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18.18
- [pnpm](https://pnpm.io) ≥ 9 (`corepack enable` will provide it)

## Getting started

```sh
pnpm install      # install workspace dependencies
pnpm build        # build all packages
pnpm typecheck    # type-check all packages
pnpm lint         # lint all packages
pnpm test         # run tests
```

The repo is a [pnpm workspace](https://pnpm.io/workspaces). Packages live under `packages/*` and
extend the shared [`tsconfig.base.json`](tsconfig.base.json). Root scripts fan out to every package
with `pnpm -r --if-present`.

## Repository layout

| Path | What |
|---|---|
| `packages/schema` | `@10s/schema` — `LevelDef` types, validation, playtest, and grid contracts |
| `packages/editor` | project homepage and public editor — canvas authoring + embedded real-engine playtest |
| `docs/` | deployment and other contributor-facing documentation |
| `tools/levels.mjs` | official-level validation/adoption/release tool used by `levels` |

## Open-source boundary

This repo is public and must stay clean of anything private:

- **Never commit game art** (PNG/JPG/etc.). Sprites are fetched at runtime from a hosted endpoint;
  `.gitignore` blocks image files as a guard.
- **Never commit secrets** — no OAuth client secrets, DB credentials, `.env` values, or tokens.
- **No engine source or unreleased official levels.** The game engine and art live separately.
  Released official JSON is intentionally public on the protected `levels` branch; drafts must
  remain under `.private/` until publication.
- Backend account / submission / moderation / anti-cheat logic lives in a **private backend repo**;
  this editor only sees the public API contract.

## Schema is the public format contract

`packages/schema/src/levelDef.ts` is the source of truth for the public `LevelDef` format.
`level.schema.json` is generated from it for non-TypeScript tools. The game vendors the built
types/validator; the protected `levels` branch consumes the same package for production checks.

After changing `LevelDef`, run `pnpm --filter @10s/schema schema:json`, update tests, and coordinate
the matching engine/schema version change before any production level uses the new field.

## Commits & pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`,
  `docs:`, `refactor:`, …), scoped where helpful (e.g. `feat(schema): …`).
- Keep PRs focused and explain any user-visible behavior changes.
- Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass before opening a PR.
