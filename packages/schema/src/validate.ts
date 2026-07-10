/**
 * Level validation — support/existence/overlap/bounds checks.
 *
 * PORTED, NOT REWRITTEN (PLAN §5d). The support + interval math below is a faithful
 * port of the private generator's `public/app.js` (hasSupport / supportFromTerrain /
 * stackSupportSurfaces / findPlacementSupport / surfaceRowForTier / surfaceIntervals /
 * ledgesOnRow / intervalCovers / mergeIntervals / carveIntervals / pitSpan /
 * materializeGround / materializeTier2). These encode the ENGINE's real "does this rest
 * on a surface" rule; rewriting them risks diverging from the engine's judgement.
 *
 * app.js drove the same math off pixel rects; here it runs in cell space (headless,
 * DOM-free) — `bottomRow = surfaceRowForTier(def, tier) + dy`, which is algebraically
 * identical to app.js's objectRect → rectBottomRow round-trip.
 *
 * SCOPE (PLAN §5d): structural legality + not-floating + count/bounds only. This does
 * NOT prove solvability — that is guaranteed by "the author must beat it in the real
 * engine". Never put a solver in here.
 *
 * Pure functions, no DOM, no Cocos, no I/O.
 */

import {
  type LevelDef,
  type GroundTileDef,
  type Tier2Def,
  type PitDef,
  MAX_RIGS,
} from './levelDef.js';
import { COLS, ROWS, TILE_W, GROUND_DROP_ROWS, TIER2_RISE_ROWS, snapHalf } from './grid.js';

// ---------------------------------------------------------------------------
// Kind metadata (headless port of app.js TOOLS default sizes + stack sets)
// ---------------------------------------------------------------------------

/** Objects that can rest ON TOP OF a box/stone (not just on terrain). */
export const STACK_SUPPORT_KINDS: ReadonlySet<string> = new Set([
  'key',
  'bomb',
  'door',
  'spike',
  'box',
  'stone',
]);

/** Objects that provide a stackable top surface (and block overlap). */
export const STACK_BLOCKER_KINDS: ReadonlySet<string> = new Set(['box', 'stone']);

/** Default footprint per object kind (cells), used when the def omits w/h. */
export const KIND_SIZE: Record<string, { w: number; h: number }> = {
  spawn: { w: 2, h: 3 },
  key: { w: 1, h: 2 },
  door: { w: 2, h: 3 },
  bomb: { w: 2, h: 2 },
  box: { w: 2, h: 2 },
  spike: { w: 2, h: 2 },
  wall: { w: 3, h: 3 },
  stone: { w: 2, h: 2 },
  plate: { w: 2, h: 1 },
  lift: { w: 3, h: 1 },
};

const KIND_LABEL: Record<string, string> = {
  spawn: '出生点',
  key: '钥匙',
  door: '出口门',
  bomb: '炸弹',
  box: '箱子',
  spike: '尖刺',
  wall: '墙',
  stone: '石块',
  plate: '压力板',
  lift: '升降台',
};

// ---------------------------------------------------------------------------
// Terrain surfaces (ported)
// ---------------------------------------------------------------------------

type Interval = [number, number];

/** Minimal shape read off any placed object. */
interface LevelObj {
  col: number;
  tier?: number;
  w?: number;
  h?: number;
  dy?: number;
}

function defaultGroundTiles(): GroundTileDef[] {
  const out: GroundTileDef[] = [];
  const end = COLS - 2;
  for (let col = 1; col <= end; col += TILE_W) {
    out.push({ col, w: Math.min(TILE_W, end - col + 1) });
  }
  return out;
}

function tilesFromSpan(span: Tier2Def | undefined): GroundTileDef[] {
  if (!span) return [];
  const out: GroundTileDef[] = [];
  for (let col = span.col0; col <= span.col1; col += TILE_W) {
    const w = Math.min(TILE_W, span.col1 - col + 1);
    if (
      span.gapCol0 !== undefined &&
      span.gapCol1 !== undefined &&
      col <= span.gapCol1 &&
      col + w - 1 >= span.gapCol0
    ) {
      continue;
    }
    out.push({ col, w });
  }
  return out;
}

/** Ground tiles in play (explicit `ground` or the legacy implicit full floor). */
export function groundTiles(def: LevelDef): GroundTileDef[] {
  return def.ground?.length ? def.ground : defaultGroundTiles();
}

/** Tier-2 tiles in play (explicit `tier2Tiles` or materialized from legacy `tier2`). */
export function tier2Tiles(def: LevelDef): GroundTileDef[] {
  return def.tier2Tiles?.length ? def.tier2Tiles : tilesFromSpan(def.tier2);
}

/** Surface row for a tier, or null if the tier does not exist (missing ledge). */
export function surfaceRowForTier(def: LevelDef, tier: number): number | null {
  if (tier <= 1) return def.floorRows - GROUND_DROP_ROWS;
  if (tier === 2) return def.floorRows - GROUND_DROP_ROWS + TIER2_RISE_ROWS;
  return def.ledges?.[tier - 3]?.row ?? null;
}

function ledgesOnRow(def: LevelDef, row: number) {
  return (def.ledges ?? []).filter((ledge) => ledge.row === row);
}

/** Two half-open ranges [a0,a1) and [b0,b1) overlap. */
export function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.01) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function pitSpan(pit: PitDef): Interval {
  return [pit.col0, pit.col0 + (pit.cells ?? pit.col1 - pit.col0 + 1)];
}

export function carveIntervals(base: Interval, removals: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const [ra, rb] of removals.slice().sort((a, b) => a[0] - b[0])) {
    const next: Interval[] = [];
    for (const [a, b] of parts) {
      if (!overlaps(a, b, ra, rb)) next.push([a, b]);
      else {
        if (ra > a) next.push([a, ra]);
        if (rb < b) next.push([rb, b]);
      }
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a > 0.01);
}

/** The covered column intervals of a tier's walkable surface (pits carved out). */
export function surfaceIntervals(def: LevelDef, tier: number): Interval[] {
  const removals = (def.pits ?? []).filter((p) => p.tier === tier).map(pitSpan);
  if (tier === 1) {
    const intervals = groundTiles(def).flatMap((tile) =>
      carveIntervals([tile.col, tile.col + (tile.w ?? TILE_W)], removals),
    );
    return mergeIntervals(intervals);
  }
  if (tier === 2) {
    const intervals = tier2Tiles(def).flatMap((tile) =>
      carveIntervals([tile.col, tile.col + (tile.w ?? TILE_W)], removals),
    );
    return mergeIntervals(intervals);
  }
  const row = surfaceRowForTier(def, tier);
  if (row === null) return [];
  const intervals = ledgesOnRow(def, row).flatMap((ledge) =>
    carveIntervals([ledge.col0, ledge.col1 + 1], removals),
  );
  return mergeIntervals(intervals);
}

export function intervalCovers(interval: Interval, col: number, w: number): boolean {
  return col >= interval[0] - 0.01 && col + w <= interval[1] + 0.01;
}

/** Does tier `tier` carry a footprint of width `w` starting at `col`? */
export function hasSupport(def: LevelDef, tier: number | null, col: number, w: number): boolean {
  return tier != null && surfaceIntervals(def, tier).some((iv) => intervalCovers(iv, col, w));
}

// ---------------------------------------------------------------------------
// Support resolution (ported)
// ---------------------------------------------------------------------------

interface Support {
  tier: number;
  bottomRow: number;
  surfaceRow: number;
  dy: number;
  distance: number;
  interval?: Interval;
}

export function supportFromTerrain(def: LevelDef, col: number, w: number, bottomRow: number): Support | null {
  const maxTier = 2 + (def.ledges?.length ?? 0);
  let best: Support | null = null;
  for (let tier = 1; tier <= maxTier; tier += 1) {
    const surface = surfaceRowForTier(def, tier);
    if (surface === null || Math.abs(bottomRow - surface) > 0.35) continue;
    if (!surfaceIntervals(def, tier).some((iv) => intervalCovers(iv, col, w))) continue;
    const support: Support = {
      tier,
      bottomRow: surface,
      surfaceRow: surface,
      dy: 0,
      distance: Math.abs(bottomRow - surface),
    };
    if (!best || support.distance < best.distance) best = support;
  }
  return best;
}

function stackSupportSurfaces(def: LevelDef, movingId: string | null = null): Support[] {
  return levelElements(def)
    .filter((item) => STACK_BLOCKER_KINDS.has(item.kind) && item.id !== movingId)
    .map((item) => {
      const baseSurface = surfaceRowForTier(def, item.tier);
      const topRow = snapHalf(item.bottomRow + item.h);
      return {
        tier: item.tier,
        interval: [item.col, item.col + item.w] as Interval,
        bottomRow: topRow,
        surfaceRow: topRow,
        dy: baseSurface === null ? 0 : snapHalf(topRow - baseSurface),
        distance: 0,
      };
    });
}

/**
 * The best surface a `kind` footprint (col,w) at `bottomRow` can rest on — terrain, or
 * (for STACK_SUPPORT_KINDS) the top of a box/stone. null = floating.
 */
export function findPlacementSupport(
  def: LevelDef,
  kind: string,
  col: number,
  w: number,
  bottomRow: number,
  movingId: string | null = null,
): Support | null {
  let best = supportFromTerrain(def, col, w, bottomRow);
  if (!STACK_SUPPORT_KINDS.has(kind)) return best;
  for (const support of stackSupportSurfaces(def, movingId)) {
    if (Math.abs(bottomRow - support.bottomRow) > 0.35) continue;
    if (!support.interval || !intervalCovers(support.interval, col, w)) continue;
    const candidate: Support = { ...support, distance: Math.abs(bottomRow - support.bottomRow) };
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Terrain materialization (ported; editor-facing mutators)
// ---------------------------------------------------------------------------

/** Expand the implicit full floor into explicit `ground` tiles (in place). */
export function materializeGround(def: LevelDef): void {
  if (!def.ground?.length) def.ground = defaultGroundTiles().map((g) => ({ ...g }));
}

/** Expand legacy `tier2` span into explicit `tier2Tiles` (in place). */
export function materializeTier2(def: LevelDef): void {
  if (!def.tier2Tiles?.length) {
    def.tier2Tiles = tilesFromSpan(def.tier2).map((g) => ({ col: g.col, w: g.w ?? TILE_W }));
    delete def.tier2;
  }
}

// ---------------------------------------------------------------------------
// Headless element enumeration (cell space)
// ---------------------------------------------------------------------------

export interface LevelElement {
  id: string;
  kind: string;
  obj: LevelObj;
  tier: number;
  col: number;
  w: number;
  h: number;
  bottomRow: number;
}

/**
 * Enumerate every placed OBJECT (not terrain) with its cell-space geometry. Objects on a
 * non-existent tier (missing ledge) are dropped — mirrors app.js's elementsForLevel,
 * which filtered items whose rect could not be computed.
 */
export function levelElements(def: LevelDef): LevelElement[] {
  const out: LevelElement[] = [];
  const add = (id: string, kind: string, obj: LevelObj, tier: number): void => {
    const surface = surfaceRowForTier(def, tier);
    if (surface === null) return;
    const size = KIND_SIZE[kind] ?? { w: 1, h: 1 };
    out.push({
      id,
      kind,
      obj,
      tier,
      col: obj.col,
      w: obj.w ?? size.w,
      h: obj.h ?? size.h,
      bottomRow: snapHalf(surface + (obj.dy ?? 0)),
    });
  };

  if (def.spawn) add('spawn', 'spawn', def.spawn, def.spawn.tier);
  if (def.key) add('key', 'key', def.key, def.key.tier);
  if (def.door) add('door', 'door', def.door, def.door.tier);
  if (def.bomb) add('bomb', 'bomb', def.bomb, def.bomb.tier);
  (def.boxes ?? []).forEach((o, i) => add(`box:${i}`, 'box', o, o.tier));
  (def.spikes ?? []).forEach((o, i) => add(`spike:${i}`, 'spike', o, o.tier));
  (def.walls ?? []).forEach((o, i) => add(`wall:${i}`, 'wall', o, o.tier));
  (def.stones ?? []).forEach((o, i) => add(`stone:${i}`, 'stone', o, o.tier ?? 1));
  (def.rigs ?? []).forEach((rig, i) => {
    add(`rig:${i}:plate`, 'plate', rig.plate, rig.plate.tier);
    add(`rig:${i}:lift`, 'lift', rig.lift, rig.lift.restTier);
  });
  return out;
}

/**
 * Would a `kind` footprint (col, bottomRow, w, h in cells) overlap the BODY of any
 * box/stone? Resting exactly on top does not count (half-open ranges). `movingId`
 * excludes the element being moved. Used by both validation and the editor's hover.
 */
export function placementOverlapsStackBlocker(
  def: LevelDef,
  kind: string,
  col: number,
  bottomRow: number,
  w: number,
  h: number,
  movingId: string | null = null,
): boolean {
  if (!STACK_SUPPORT_KINDS.has(kind)) return false;
  return levelElements(def).some(
    (item) =>
      STACK_BLOCKER_KINDS.has(item.kind) &&
      item.id !== movingId &&
      overlaps(col, col + w, item.col, item.col + item.w) &&
      overlaps(bottomRow, bottomRow + h, item.bottomRow, item.bottomRow + item.h),
  );
}

function labelFor(el: LevelElement): string {
  const base = KIND_LABEL[el.kind] ?? el.kind;
  const m = el.id.match(/:(\d+)/);
  return m ? `${base} ${Number(m[1]) + 1}` : base;
}

// ---------------------------------------------------------------------------
// Public validation
// ---------------------------------------------------------------------------

export type ValidationCode =
  | 'missing' // required singleton (spawn/key/door) absent or malformed
  | 'invalid' // malformed level/object/terrain data
  | 'invalid-tier' // object references a tier that does not exist
  | 'floating' // object rests on no surface
  | 'overlap' // object overlaps a box/stone body
  | 'out-of-bounds' // object leaves the grid
  | 'terrain-overlap' // terrain pieces overlap each other
  | 'control-area' // key/door under the bottom-left on-screen controls
  | 'rig-limit'; // more than MAX_RIGS rigs

export interface ValidationIssue {
  /** Element id ('key', 'door', 'box:0', 'rig:0:plate', …) for the editor to highlight. */
  ref: string;
  /** Human-readable Chinese reason for the editor's red-box list. */
  reason: string;
  code: ValidationCode;
}

function isPlacedSingleton(obj: unknown): obj is LevelObj {
  return (
    !!obj &&
    typeof obj === 'object' &&
    typeof (obj as LevelObj).col === 'number' &&
    typeof (obj as LevelObj).tier === 'number'
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface RawLevelElement {
  id: string;
  kind: string;
  obj: LevelObj;
  tier: number;
}

/** Enumerate objects before tier geometry is resolved, so invalid tiers cannot disappear. */
function rawLevelElements(def: LevelDef): RawLevelElement[] {
  const out: RawLevelElement[] = [];
  const add = (id: string, kind: string, obj: LevelObj | undefined, tier: number | undefined): void => {
    if (obj && tier !== undefined) out.push({ id, kind, obj, tier });
  };

  add('spawn', 'spawn', def.spawn, def.spawn?.tier);
  add('key', 'key', def.key, def.key?.tier);
  add('door', 'door', def.door, def.door?.tier);
  add('bomb', 'bomb', def.bomb, def.bomb?.tier);
  (def.boxes ?? []).forEach((o, i) => add(`box:${i}`, 'box', o, o.tier));
  (def.spikes ?? []).forEach((o, i) => add(`spike:${i}`, 'spike', o, o.tier));
  (def.walls ?? []).forEach((o, i) => add(`wall:${i}`, 'wall', o, o.tier));
  (def.stones ?? []).forEach((o, i) => add(`stone:${i}`, 'stone', o, o.tier ?? 1));
  (def.rigs ?? []).forEach((rig, i) => {
    add(`rig:${i}:plate`, 'plate', rig.plate, rig.plate?.tier);
    add(`rig:${i}:lift`, 'lift', rig.lift, rig.lift?.restTier);
  });
  return out;
}

function validateTerrain(def: LevelDef, issues: ValidationIssue[]): void {
  const validateTiles = (tiles: GroundTileDef[] | undefined, prefix: 'ground' | 'tier2tile'): void => {
    (tiles ?? []).forEach((tile, index) => {
      const ref = `${prefix}:${index}`;
      const w = tile.w ?? TILE_W;
      if (!isFiniteNumber(tile.col) || !isFiniteNumber(w) || w <= 0) {
        issues.push({ ref, code: 'invalid', reason: `${prefix === 'ground' ? '地块' : '二层平台'} ${index + 1} 数据无效` });
      } else if (tile.col < 0 || tile.col + w > COLS) {
        issues.push({ ref, code: 'out-of-bounds', reason: `${prefix === 'ground' ? '地块' : '二层平台'} ${index + 1} 超出边界` });
      }
    });

    for (let i = 0; i < (tiles?.length ?? 0); i += 1) {
      const a = tiles![i];
      const aw = a.w ?? TILE_W;
      if (!isFiniteNumber(a.col) || !isFiniteNumber(aw)) continue;
      for (let j = i + 1; j < tiles!.length; j += 1) {
        const b = tiles![j];
        const bw = b.w ?? TILE_W;
        if (!isFiniteNumber(b.col) || !isFiniteNumber(bw)) continue;
        if (overlaps(a.col, a.col + aw, b.col, b.col + bw)) {
          issues.push({
            ref: `${prefix}:${j}`,
            code: 'terrain-overlap',
            reason: `${prefix === 'ground' ? '地块' : '二层平台'} ${j + 1} 与其它地形重叠`,
          });
        }
      }
    }
  };

  validateTiles(def.ground, 'ground');
  validateTiles(def.tier2Tiles, 'tier2tile');

  (def.ledges ?? []).forEach((ledge, index) => {
    const ref = `platform:${index}`;
    if (![ledge.col0, ledge.col1, ledge.row].every(isFiniteNumber) || ledge.col1 < ledge.col0) {
      issues.push({ ref, code: 'invalid', reason: `平台 ${index + 1} 数据无效` });
    } else if (ledge.col0 < 0 || ledge.col1 >= COLS || ledge.row < 0 || ledge.row > ROWS) {
      issues.push({ ref, code: 'out-of-bounds', reason: `平台 ${index + 1} 超出边界` });
    }
  });
  for (let i = 0; i < (def.ledges?.length ?? 0); i += 1) {
    const a = def.ledges![i];
    for (let j = i + 1; j < def.ledges!.length; j += 1) {
      const b = def.ledges![j];
      if (a.row === b.row && overlaps(a.col0, a.col1 + 1, b.col0, b.col1 + 1)) {
        issues.push({ ref: `platform:${j}`, code: 'terrain-overlap', reason: `平台 ${j + 1} 与其它地形重叠` });
      }
    }
  }

  (def.pits ?? []).forEach((pit, index) => {
    const [a, b] = pitSpan(pit);
    if (![pit.tier, pit.col0, pit.col1, a, b].every(isFiniteNumber) || b <= a) {
      issues.push({ ref: `pit:${index}`, code: 'invalid', reason: `坑 ${index + 1} 数据无效` });
    } else if (a < 0 || b > COLS || surfaceRowForTier(def, pit.tier) === null) {
      issues.push({ ref: `pit:${index}`, code: 'out-of-bounds', reason: `坑 ${index + 1} 超出有效地形` });
    }
  });
}

/**
 * Validate a level: existence of the required singletons, nothing floating, no overlap
 * with box/stone bodies, in-bounds, and rig count. Returns [] when the level is legal.
 * Structure only — solvability is not checked (see file header).
 */
export function validateLevel(def: LevelDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isFiniteNumber(def.recordSteps) || def.recordSteps <= 0) {
    issues.push({ ref: 'level', code: 'invalid', reason: '录制步数必须大于 0' });
  }
  if (!isFiniteNumber(def.floorRows) || def.floorRows <= 0 || def.floorRows > ROWS) {
    issues.push({ ref: 'level', code: 'invalid', reason: '地面高度无效' });
  }
  if (!Number.isInteger(def.clones) || def.clones < 0 || def.clones > 2) {
    issues.push({ ref: 'level', code: 'invalid', reason: '分身数必须是 0–2' });
  }

  validateTerrain(def, issues);

  // Existence of required singletons (untrusted JSON may omit them).
  for (const ref of ['spawn', 'key', 'door'] as const) {
    if (!isPlacedSingleton(def[ref])) {
      issues.push({ ref, code: 'missing', reason: `缺少${KIND_LABEL[ref]}` });
    }
  }

  for (const raw of rawLevelElements(def)) {
    const size = KIND_SIZE[raw.kind] ?? { w: 1, h: 1 };
    const w = raw.obj.w ?? size.w;
    const h = raw.obj.h ?? size.h;
    if (![raw.obj.col, raw.tier, w, h, raw.obj.dy ?? 0].every(isFiniteNumber) || w <= 0 || h <= 0) {
      issues.push({ ref: raw.id, code: 'invalid', reason: `${KIND_LABEL[raw.kind] ?? raw.kind} 数据无效` });
      continue;
    }
    if (surfaceRowForTier(def, raw.tier) === null) {
      issues.push({ ref: raw.id, code: 'invalid-tier', reason: `${KIND_LABEL[raw.kind] ?? raw.kind} 所在层级不存在` });
    }
  }

  (def.rigs ?? []).forEach((rig, index) => {
    if (!isFiniteNumber(rig.lift?.topTier) || surfaceRowForTier(def, rig.lift.topTier) === null) {
      issues.push({ ref: `rig:${index}:lift`, code: 'invalid-tier', reason: `升降台 ${index + 1} 的目标层级不存在` });
    }
  });

  for (const item of levelElements(def)) {
    const label = labelFor(item);
    if (!findPlacementSupport(def, item.kind, item.col, item.w, item.bottomRow, item.id)) {
      issues.push({ ref: item.id, code: 'floating', reason: `${label} 悬空` });
    } else if (
      placementOverlapsStackBlocker(def, item.kind, item.col, item.bottomRow, item.w, item.h, item.id)
    ) {
      issues.push({ ref: item.id, code: 'overlap', reason: `${label} 与石头/箱子重叠` });
    }
    if (item.col < 0 || item.col + item.w > COLS || item.bottomRow < 0 || item.bottomRow + item.h > ROWS) {
      issues.push({ ref: item.id, code: 'out-of-bounds', reason: `${label} 超出边界` });
    }
  }

  // Bottom-left on-screen controls occupy the ground near col 0 (PLAN §5d / app.js).
  if (def.key?.tier === 1 && def.key.col < 8) {
    issues.push({ ref: 'key', code: 'control-area', reason: '钥匙靠近左下控件区' });
  }
  if (def.door?.tier === 1 && def.door.col < 8) {
    issues.push({ ref: 'door', code: 'control-area', reason: '出口门靠近左下控件区' });
  }

  if ((def.rigs?.length ?? 0) > MAX_RIGS) {
    issues.push({ ref: 'rig:0:plate', code: 'rig-limit', reason: `压力板+升降台最多 ${MAX_RIGS} 组` });
  }

  return issues;
}

/** True when the level passes every structural check (nothing to fix). */
export function isPlayable(def: LevelDef): boolean {
  return validateLevel(def).length === 0;
}

/**
 * Defensive public shape guard for stored/imported JSON. It is intentionally stricter than
 * the game's minimal `PlaytestBridge.isValidDraft`, because malformed nested arrays must not
 * crash the editor before validation can explain the problem.
 */
export function isLevelDefShape(def: unknown): def is LevelDef {
  const d = def as LevelDef;
  const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
  const isRecordArray = (value: unknown): boolean => value === undefined || (Array.isArray(value) && value.every(isRecord));
  const hasPosition = (value: unknown): boolean =>
    isRecord(value) && isFiniteNumber(value.col) && isFiniteNumber(value.tier);
  return (
    isRecord(d) &&
    typeof d.name === 'string' &&
    isFiniteNumber(d.recordSteps) &&
    isFiniteNumber(d.floorRows) &&
    isFiniteNumber(d.clones) &&
    Array.isArray(d.rigs) &&
    d.rigs.every(
      (rig) =>
        isRecord(rig) &&
        isRecord(rig.plate) &&
        isFiniteNumber(rig.plate.col) &&
        isFiniteNumber(rig.plate.tier) &&
        isRecord(rig.lift) &&
        isFiniteNumber(rig.lift.col) &&
        isFiniteNumber(rig.lift.restTier) &&
        isFiniteNumber(rig.lift.topTier),
    ) &&
    hasPosition(d.key) &&
    hasPosition(d.door) &&
    hasPosition(d.spawn) &&
    (d.bomb === undefined || hasPosition(d.bomb)) &&
    isRecordArray(d.ground) &&
    isRecordArray(d.tier2Tiles) &&
    isRecordArray(d.ledges) &&
    isRecordArray(d.stones) &&
    isRecordArray(d.spikes) &&
    isRecordArray(d.walls) &&
    isRecordArray(d.boxes) &&
    isRecordArray(d.pits)
  );
}
