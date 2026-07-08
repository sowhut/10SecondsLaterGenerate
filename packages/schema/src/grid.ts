/**
 * Logical level grid constants + snapping helpers.
 *
 * Mirrors the game's `assets/scripts/Grid.ts` (PLAN §5c). The editor Canvas may use
 * its own pixel coordinates; what MUST stay consistent is the col/row/tier SEMANTICS
 * saved back into a LevelDef. Pure math — no DOM, no Cocos.
 */

export const DESIGN_W = 1280;
export const DESIGN_H = 720;

export const COLS = 50;
export const ROWS = 26;

/** Edge length of one logical cell, in design pixels (1280 / 50 = 25.6). */
export const CELL = DESIGN_W / COLS;

/** Left edge of column 0 (Cocos world X). */
export const ORIGIN_X = -DESIGN_W / 2; // -640
/** Bottom edge of row 0 (Cocos world Y). */
export const ORIGIN_Y = -DESIGN_H / 2; // -360

/**
 * Tier → surface-row geometry (mirrors the engine / old generator app.js):
 *   - tier 1 (ground): surface row = floorRows - GROUND_DROP_ROWS
 *   - tier 2:          surface row = floorRows - GROUND_DROP_ROWS + TIER2_RISE_ROWS
 *   - tier 3+ (ledge): surface row = ledges[tier - 3].row (all ledges sharing that row
 *                      merge into one surface at runtime)
 * See surfaceRowForTier() in ./validate.
 */
export const GROUND_DROP_ROWS = 1.5;
export const TIER2_RISE_ROWS = 4.7;

/** Default terrain tile width in cells (ground / tier-2 pieces are authored in 3s). */
export const TILE_W = 3;

/** Snap a value to the nearest half cell (the editor's 0.5-grid). */
export function snapHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/** Clamp `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
