# 10 Seconds Later — Level Editor (10SecondsLaterGenerate)

Open-source, browser-based **level editor** for the game *10 Seconds Later（10秒之后）*:
build a level → **playtest it in the real game engine** → beat it yourself → export / submit.

> **This repo is the public Web editor monorepo.** It contains the level **format**, **sample levels**,
> and the **editor front-end** only. The game engine, art assets, commercial levels, and backend
> (accounts / submissions / moderation) live in separate private repos. **No game art is bundled here** —
> sprites are fetched at runtime from a hosted endpoint.

## Start here

📋 **[`docs/PLAN.md`](docs/PLAN.md)** — the complete, self-contained execution plan (read it fully before coding):
target architecture, the `LevelDef` schema, the Cocos playtest sandbox contract, milestones (M0–M6), and verification.

## Layout (target)

```
packages/schema   @10s/schema — LevelDef types + validation + playtest contract
packages/editor   the public editor (canvas authoring + embedded real-engine playtest + export/submit)
examples/         sample level JSON + format docs
```

Packages arrive per milestone (M1 = `schema`, M2 = `editor`, M5 = `examples`). The current
milestone is **M0 (scaffolding)** — repo tooling only.

## Develop

Requires [Node.js](https://nodejs.org) ≥ 18 and [pnpm](https://pnpm.io) ≥ 9.

```sh
pnpm install      # install workspace dependencies
pnpm build        # build all packages
pnpm typecheck    # type-check all packages
pnpm lint         # lint all packages
```

Workspace scripts fan out to every package via `pnpm -r --if-present`, so they stay green
even before a package implements a given script.

## License

Code: **[MIT](LICENSE)**. **Game art is NOT included** in this repo and is all-rights-reserved /
non-commercial — sprites are fetched at runtime from a hosted endpoint (see
[`docs/PLAN.md`](docs/PLAN.md) §9).
