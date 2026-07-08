/**
 * LevelDef — the public level-format schema for 10 Seconds Later.
 *
 * MIRROR, NOT SOURCE OF TRUTH. The authoritative definition lives in the game's
 * private repo at `assets/scripts/level/LevelDef.ts`. This file is its public
 * contract, kept field-for-field in sync (PLAN §2.6, §6-M1, §10.4). When the game
 * schema changes, change it here in the same breath — the game wins on conflict.
 *
 * Every interface below is copied verbatim from the game LevelDef.ts.
 */

export interface SpawnDef {
  col: number;
  tier: number; // 1 = ground
  w?: number; // hero footprint width in cells (default 2)
  h?: number; // hero footprint height in cells (default 3)
}

export interface RigDef {
  plate: { col: number; w: number; tier: number };
  lift: { col: number; w: number; restTier: number; topTier: number };
  color: string;
}

export interface LedgeDef {
  col0: number;
  col1: number; // inclusive last column
  row: number; // surface row
}

/** Explicit 3-cell ground tile. Missing `ground` keeps the legacy full floor. */
export interface GroundTileDef {
  col: number;
  w?: number; // default 3
}

export interface Tier2Def {
  col0: number;
  col1: number; // inclusive last column
  gapCol0?: number;
  gapCol1?: number; // inclusive last gap column
}

export interface KeyDef {
  col: number;
  tier: number;
  w?: number;
  h?: number;
  dy?: number; // vertical offset in cells from the tier surface
}

/** Climbable 2-cell ground block (stand on top, soft side-block). */
export interface StoneDef {
  col: number;
  w: number;
  tier?: number; // default 1 (ground)
  dy?: number; // vertical offset in cells (stack stones with dy = lower stone height)
}

/** Lethal spike strip: blocks walking, kills a too-low airborne pass. */
export interface SpikeDef {
  col: number;
  w: number;
  tier: number;
  dy?: number; // vertical offset in cells from the tier surface
}

/** Breakable hard wall (removed by a bomb in range). */
export interface WallDef {
  col: number;
  w: number;
  h: number;
  tier: number;
}

/** A carryable bomb (2×2) resting on a tier. */
export interface BombDef {
  col: number;
  tier: number;
  dy?: number; // vertical offset in cells from the tier surface (e.g. sit ON a stone)
}

/** A pushable crate (2 wide × `h` tall, default 2) resting on a tier. */
export interface BoxDef {
  col: number;
  tier: number;
  h?: number; // height in cells (default 2). 4 = a 2-high stack pushed/falls as one unit.
  dy?: number; // vertical offset in cells (stack a crate on another: dy = lower crate height)
}

/**
 * A gap carved out of a tier's surface — a real hole, not a death-band. Use `cells`
 * for a FRACTIONAL width from col0 on non-ground tiers; ground pits stay block-aligned
 * via col0/col1.
 */
export interface PitDef {
  tier: number; // 1 = ground, 2 = tier-2, 3+ = ledge
  col0: number;
  col1: number; // inclusive last column (integer fallback width)
  cells?: number; // optional fractional width in cells from col0; overrides col1 for the gap span
}

/** Per-level background palette (cheap visual differentiation between levels). */
export interface ThemeDef {
  void: string;
  upper: string;
  lower: string;
}

export interface DoorDef {
  col: number;
  tier: number;
  w: number;
  h: number;
  dy?: number; // vertical nudge in cells
  glow?: [string, number];
}

export interface LevelDef {
  name: string;
  recordSteps: number; // steps per clone track (600 = 10 s)
  floorRows: number;
  /**
   * Minimum engine feature version this level needs. Omitted = 1 (baseline). When a
   * remote level requires a newer engine than the running client, the client gates it
   * as "需要更新版本" instead of crashing.
   */
  minEngineVersion?: number;
  /** Placeholder slot: shows on the menu ("敬请期待") but is not playable. */
  comingSoon?: boolean;
  /** Legacy continuous tier-2 span; prefer tier2Tiles for editable 3-cell pieces. */
  tier2?: Tier2Def;
  tier2Tiles?: GroundTileDef[];
  ledges?: LedgeDef[];
  rigs: RigDef[];
  key: KeyDef;
  door: DoorDef;
  /** How many clones to record before the 真身 run (total actors = clones + 1). */
  clones: number;
  /** Single shared spawn for ALL actors (宪法: 单一出生点). Varies per level. */
  spawn: SpawnDef;
  theme?: ThemeDef;
  ground?: GroundTileDef[];
  stones?: StoneDef[];
  spikes?: SpikeDef[];
  walls?: WallDef[];
  bomb?: BombDef;
  boxes?: BoxDef[];
  pits?: PitDef[];
}

/**
 * Submission / export envelope. Matches the game's `tools/export-levels.mts` body
 * ({schemaVersion, minEngineVersion, def}) and reserves `author` so the future
 * backend can stamp it with zero editor changes (PLAN §5a, §2.4).
 */
export interface LevelEnvelope {
  schemaVersion: number; // currently 1
  minEngineVersion: number; // default 1
  def: LevelDef;
  author?: { id: string; name: string; provider: 'github' };
}

/**
 * Highest level-data schema this build understands. MUST equal the game's
 * `LevelConfig.SCHEMA_VERSION` (game repo). Bump only on a breaking LevelDef change.
 */
export const SCHEMA_VERSION = 1;

/** Default `minEngineVersion` when a level/envelope omits it (mirrors the game). */
export const DEFAULT_MIN_ENGINE_VERSION = 1;

/**
 * Max plate↔lift rigs per level (PLAN §5d). Each rig auto-colors from RIG_COLORS by
 * index. NOTE: the old private generator capped this at 2; PLAN raised it to 3.
 */
export const MAX_RIGS = 3;

/** Canonical per-rig colors, assigned by rig index (PLAN §5d). */
export const RIG_COLORS: readonly string[] = ['#46E5F2', '#FFB23E', '#ED4DB7'];

/**
 * Named background palettes, mirrored from the game's `LevelDef.ts` THEME const. All
 * stay in the dark indigo / violet cave family (art direction — no off-brand hues).
 * These are level-format data (color triples), not bundled art.
 */
export const THEMES: Record<string, ThemeDef> = {
  indigo: { void: '#050817', upper: '#0D1028', lower: '#17132F' },
  violet: { void: '#08071A', upper: '#160F30', lower: '#221638' },
  azure: { void: '#050A18', upper: '#0C1630', lower: '#14223C' },
  plum: { void: '#0A0718', upper: '#1A0F2C', lower: '#261736' },
  blue: { void: '#060A1A', upper: '#0D1434', lower: '#161E40' },
  deepviolet: { void: '#090720', upper: '#140E34', lower: '#1E1640' },
  steel: { void: '#070A16', upper: '#10182E', lower: '#1A2440' },
  royal: { void: '#0A0820', upper: '#18103A', lower: '#241846' },
};

/** Default door glow ([color, radius]), mirrored from the game. */
export const DOOR_GLOW: [string, number] = ['#C265FF', 22];
