# Contributing

Thanks for your interest in the **10 Seconds Later** open-source level editor!

This repository is the **public Web editor monorepo**. Before contributing, please read
[`docs/PLAN.md`](docs/PLAN.md) — it is the single, self-contained execution plan (architecture,
the `LevelDef` schema, the playtest sandbox contract, milestones M0–M6, and verification).

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
| `packages/schema` | `@10s/schema` — `LevelDef` types, validation, playtest & grid contracts (arrives at M1) |
| `packages/editor` | the public editor front-end — canvas authoring + embedded real-engine playtest + export/submit (M2+) |
| `examples/` | sample level JSON + format docs (M5) |
| `docs/` | `PLAN.md` (execution plan) and `LEVEL_FORMAT.md` (community format doc, M5) |

## Open-source boundary (hard rules — see `docs/PLAN.md` §9)

This repo is public and must stay clean of anything private:

- **Never commit game art** (PNG/JPG/etc.). Sprites are fetched at runtime from a hosted endpoint;
  `.gitignore` blocks image files as a guard.
- **Never commit secrets** — no OAuth client secrets, DB credentials, `.env` values, or tokens.
- **No engine source or full commercial levels.** The game engine and art live in a separate private
  repo; only the level *format*, a few teaching *examples*, and the *editor front-end* are public.
- Backend account / submission / moderation / anti-cheat logic lives in a **private backend repo**;
  this editor only sees the public API contract.

## Schema is mirrored, not owned

The `LevelDef` format's source of truth is the game's private
`assets/scripts/level/LevelDef.ts`. `packages/schema` is its public mirror — keep them in sync
(`docs/PLAN.md` §2.6, §10.4). Don't fork the format here.

## Commits & pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`,
  `docs:`, `refactor:`, …), scoped where helpful (e.g. `feat(schema): …`).
- Keep PRs focused; reference the milestone (M0–M6) they advance.
- Ensure `pnpm typecheck` and `pnpm build` pass before opening a PR — CI runs them.
