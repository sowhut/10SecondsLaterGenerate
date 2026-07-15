# @10s/schema

The TypeScript declarations in `src/levelDef.ts` are the public format source of
truth. `level.schema.json` is generated from `LevelDef` for non-TypeScript tools:

```sh
pnpm --filter @10s/schema schema:json
```

The JSON Schema contains only the public format. Released official JSON lives separately
on the protected `levels` branch and is never generated into this package.

The public **level-format contract** for *10 Seconds Later* — types, validation, and the
playtest + grid contracts shared by the editor (browser) and the future backend (Node).

Pure TypeScript, **zero runtime dependencies**, no DOM, no Cocos.

## Modules

| Module | Exports |
|---|---|
| `levelDef` | `LevelDef` + all sub-interfaces, `LevelEnvelope`, `SCHEMA_VERSION`, `DEFAULT_MIN_ENGINE_VERSION`, `MAX_RIGS`, `RIG_COLORS` |
| `grid` | `COLS/ROWS/CELL/ORIGIN_X/ORIGIN_Y/DESIGN_*`, `GROUND_DROP_ROWS`, `TIER2_RISE_ROWS`, `TILE_W`, `snapHalf`, `clamp` |
| `playtest` | frozen sandbox message strings `PLAYTEST_IN` / `PLAYTEST_RESULT` / `SANDBOX_READY` + message types |
| `validate` | `validateLevel` → `ValidationIssue[]`, `isPlayable`, `isLevelDefShape`, and the ported support/interval helpers (`surfaceRowForTier`, `surfaceIntervals`, `hasSupport`, `findPlacementSupport`, `groundTiles`, `tier2Tiles`, `materializeGround`, `materializeTier2`, `levelElements`) |

```ts
import { validateLevel, isPlayable, SCHEMA_VERSION } from '@10s/schema';

const issues = validateLevel(def); // [] when structurally legal
if (isPlayable(def)) { /* allow playtest */ }
```

## Scripts

```sh
pnpm --filter @10s/schema build      # tsc → dist/*.js + *.d.ts
pnpm --filter @10s/schema typecheck  # tsc --noEmit (incl. tests)
pnpm --filter @10s/schema test       # node:test + tsx
```

## Source of truth and runtime parity

`src/levelDef.ts` is authoritative for the serializable level shape. JSON Schema and the
game's TypeScript types are generated/synchronized from it. Runtime behavior still belongs
to the game engine, so these cross-repo version contracts remain deliberate:

- `SCHEMA_VERSION` must equal the game's `LevelConfig.SCHEMA_VERSION`.
- `PLAYTEST_IN` / `PLAYTEST_RESULT` must equal the strings in the game's `PlaytestBridge.ts`.
- The support/validation math is a **faithful port** of the private generator's `app.js`
  (`hasSupport` / `findPlacementSupport` / interval carving) — it encodes the engine's real
  "rests on a surface" rule. Port, don't rewrite. **Validation checks structure only; it does
  not prove solvability** (that is guaranteed by the author beating their own level in the
  real engine).

Any format change must update this contract, the engine implementation, and the corresponding
schema/engine version in the same release sequence.
