# @10s/editor

The personal project homepage and public, browser-based **level editor** for
*10 Seconds Later* — Canvas authoring built on top of [`@10s/schema`](../schema).
Vite multi-page build + TypeScript, no framework.

## Develop

```sh
cp packages/editor/.env.example packages/editor/.env.local
# Set the hosted sprite and Cocos sandbox URLs in .env.local
pnpm dev                                 # homepage: http://127.0.0.1:5180
                                         # editor:   http://127.0.0.1:5180/editor/
```

Place / move / delete props on the canvas; validation (floating / out-of-bounds / missing
spawn·key·door / rig > 3) is driven by `validateLevel` and shown as red boxes + a reasons list.
Drafts persist to `localStorage` (`10s.editor.drafts.v1`) — refresh-safe.

Import accepts a bare `LevelDef` or a standard `LevelEnvelope`. Export emits a
production-compatible `LevelEnvelope` and remains locked until the exact current draft has
passed validation and been beaten in the real Cocos playtest sandbox. Import/export only reads
and downloads local browser files; it never receives repository or GitHub write access.

## Configuration (`src/config.ts`, injected via Vite `import.meta.env`)

| Env var | Default | Purpose |
|---|---|---|
| `VITE_SPRITE_BASE_URL` | `/sprites` | hosted art endpoint (`<name>.png`). **No PNGs in this repo.** |
| `VITE_SANDBOX_URL` | `''` | hosted Cocos web build used by local and hosted editors |
| `VITE_API_BASE_URL` | `''` | private backend for M4 submit (empty = local-only) |

For local dev with real art, point `VITE_SPRITE_BASE_URL` at a running endpoint, e.g.:

```sh
VITE_SPRITE_BASE_URL=http://127.0.0.1:5179/sprites pnpm --filter @10s/editor dev
```

Without it, sprites gracefully degrade to labeled placeholder boxes.

## Boundaries

- **Never writes the game or GitHub repository** — output is local drafts and downloaded JSON.
- Maintainers explicitly apply an export inside a protected `levels` worktree with
  `pnpm levels:apply -- file.json L08`; replacing an existing id additionally requires
  `--replace`.
- **All** support / validation / geometry / constants come from `@10s/schema` — this package
  keeps no copy of that logic.
- Playtest sandbox (`src/playtestEmbed.ts`) mounts the hosted Cocos build, waits for the ready
  handshake, injects the exact draft, validates message origin/source, and reports failures.

## Structure

| File | Role |
|---|---|
| `index.html` / `src/home.css` | personal project homepage at `/` |
| `editor/index.html` | editor HTML entry at `/editor/` |
| `src/config.ts` | env-injected endpoints |
| `src/drafts.ts` | localStorage draft store + blank-level factory |
| `src/levelFiles.ts` | defensive LevelDef/LevelEnvelope JSON import + canonical export |
| `src/editor.ts` | canvas render + placement + inspector/validation UI (ported from the private generator) |
| `src/playtestEmbed.ts` | hosted Cocos iframe + playtest handshake/result lifecycle |
| `src/main.ts` | editor TypeScript entry |
