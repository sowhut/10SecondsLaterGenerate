# 10 Seconds Later — Level Editor

Personal project homepage and open-source, browser-based level editor for
*10 Seconds Later（10 秒之后）*:
build a level → playtest it in the real Cocos engine → beat it yourself → export / submit.

Project website: [10secslater.com](https://10secslater.com/)

The editor can run **locally or as a hosted website**. Both modes embed the same Cocos
playtest sandbox deployed by the game team, so GitHub users do not need the private game
source in order to playtest their drafts.

> This repository contains the public level format and editor front-end. The game engine,
> art assets, commercial levels, authentication, submissions, and moderation backend live
> outside this repository. No game art or secrets are bundled here.

## Current status

- **M0–M2 complete:** monorepo, schema/validation package, Canvas editor, local drafts.
- **M3 editor side complete:** embedded real-engine playtest via a strict `postMessage`
  handshake. A compatible hosted Cocos sandbox is required for end-to-end playtesting.
- **Next:** JSON export/import, submissions, examples, and the public level-format guide.

## Run the editor locally

Requires Node.js ≥ 18.18 and pnpm ≥ 9.

```sh
pnpm install
cp packages/editor/.env.example packages/editor/.env.local
# Edit VITE_SANDBOX_URL / VITE_SPRITE_BASE_URL in .env.local
pnpm dev
```

Open `http://127.0.0.1:5180` for the project homepage, then enter the editor at
`http://127.0.0.1:5180/editor/`. Without a sprite endpoint the editor uses labeled
placeholders. Without a valid sandbox endpoint authoring still works, but the Playtest button
is disabled.

## Deployment

The Vite build produces both `/` (personal project homepage) and `/editor/` (editor).
GitHub Actions runs lint, type-checks, tests, and builds every change; pushes to `main`
can then deploy the static output to the Tencent Cloud Nginx host over SSH. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the one-time server and GitHub setup.

## Hosted sandbox model

```text
local editor (127.0.0.1:5180) ─┐
                               ├─ iframe + postMessage ─> hosted Cocos sandbox
hosted editor (your domain) ───┘
```

`VITE_SANDBOX_URL` is a public **build-time URL**, not a secret. The sandbox deployment must:

- serve the current Cocos web build over HTTPS;
- allow iframe embedding by both the production editor origin and documented localhost
  development origins (`Content-Security-Policy: frame-ancestors ...`);
- emit `10s.sandboxReady`, accept `10s.playtest`, and return `10s.playtestResult`;
- validate the parent origin against an allowlist containing the production editor and local
  development origins.

The editor rejects non-HTTP(S) sandbox URLs and accepts messages only from the configured
sandbox origin and iframe window.

## Quality checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## License and assets

Source code is licensed under the [MIT License](LICENSE). Game art is not included and is not
licensed under MIT; sprites are fetched from a separately hosted endpoint.
