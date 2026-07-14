# @10s/schema

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

## ⚠️ This is a mirror, not the source of truth

The authoritative `LevelDef` lives in the **game's private repo**
(`assets/scripts/level/LevelDef.ts`). This package mirrors it field-for-field and must be
kept in sync deliberately. Likewise:

- `SCHEMA_VERSION` must equal the game's `LevelConfig.SCHEMA_VERSION`.
- `PLAYTEST_IN` / `PLAYTEST_RESULT` must equal the strings in the game's `PlaytestBridge.ts`.
- The support/validation math is a **faithful port** of the private generator's `app.js`
  (`hasSupport` / `findPlacementSupport` / interval carving) — it encodes the engine's real
  "rests on a surface" rule. Port, don't rewrite. **Validation checks structure only; it does
  not prove solvability** (that is guaranteed by the author beating their own level in the
  real engine).

On any conflict, the game repo wins — or change both sides deliberately in the same step.
