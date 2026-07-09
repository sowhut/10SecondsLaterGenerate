/**
 * Public level editor — Canvas authoring UI.
 *
 * Ported from the private generator's `public/app.js`, with three deliberate changes
 * (HANDOFF M2):
 *   1. All support / validation / geometry come from `@10s/schema` — no local copies.
 *   2. No server: new/open/clone/delete + autosave go through the localStorage draft
 *      store (`./drafts`). The editor NEVER writes the game's LevelDef.ts.
 *   3. Sprites load from a configurable hosted endpoint (`CONFIG.SPRITE_BASE_URL`);
 *      missing art degrades to a labeled placeholder. No PNGs live in this repo.
 *
 * Playtest embed (M3) and export/submit (M4) are out of scope here.
 */
import {
  type LevelDef,
  type RigDef,
  type ThemeDef,
  COLS,
  ROWS,
  CELL,
  DESIGN_W,
  DESIGN_H,
  TILE_W,
  GROUND_DROP_ROWS,
  snapHalf,
  clamp,
  MAX_RIGS,
  RIG_COLORS,
  THEMES,
  DOOR_GLOW,
  KIND_SIZE,
  surfaceRowForTier,
  groundTiles,
  tier2Tiles,
  materializeGround,
  materializeTier2,
  findPlacementSupport,
  placementOverlapsStackBlocker,
  pitSpan,
  overlaps,
  validateLevel,
} from '@10s/schema';

import { CONFIG } from './config';
import { type LevelDoc, loadDocs, saveDocs, makeDefaultLevel, newDocId } from './drafts';
import { openPlaytest, isPlaytestConfigured } from './playtestEmbed';

// --------------------------------------------------------------------------- types
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ToolDef {
  id: string;
  label: string;
  sprite?: string;
  singleton?: boolean;
  arrayKey?: string;
  w: number;
  h: number;
  support?: boolean;
  terrain?: boolean;
}
interface EditorElement {
  id: string;
  kind: string;
  label: string;
  obj: any;
  index?: number;
  arrayKey?: string;
  implicit?: boolean;
  singleton?: boolean;
  sprite?: string;
  rig?: RigDef;
  rect: Rect;
  w?: number;
  h?: number;
}
interface Pending {
  mode: 'move' | 'create';
  kind: string;
  itemId?: string;
  offsetCol: number;
  offsetRow: number;
  snapshot?: LevelDef;
  dirtyBefore: boolean;
  toolW?: number;
  toolH?: number;
}
interface Placement {
  col: number;
  row?: number;
  tier?: number | null;
  dy?: number;
  surfaceRow?: number;
  platformTier?: number;
  valid: boolean;
}

// --------------------------------------------------------------------------- constants
const BORDER = 3;
const COLORS = {
  selected: '#46E5F2',
  valid: '#68F28C',
  invalid: '#FF4F7B',
  platform: '#49306E',
  platformTop: '#7B5AA7',
  void: '#050817',
};

// UI palette. Footprint sizes for OBJECT kinds come from schema `KIND_SIZE` (single
// source of truth); terrain kinds (ground/platform) are editor-only tile sizes.
const TOOLS: ToolDef[] = [
  { id: 'spawn', label: '出生点', sprite: 'hero', singleton: true, support: true, ...KIND_SIZE.spawn },
  { id: 'key', label: '钥匙', sprite: 'key', singleton: true, support: true, ...KIND_SIZE.key },
  { id: 'door', label: '出口门', sprite: 'door_closed', singleton: true, support: true, ...KIND_SIZE.door },
  { id: 'bomb', label: '炸弹', sprite: 'bomb', singleton: true, support: true, ...KIND_SIZE.bomb },
  { id: 'box', label: '箱子', sprite: 'box', arrayKey: 'boxes', support: true, ...KIND_SIZE.box },
  { id: 'spike', label: '尖刺', sprite: 'spikes', arrayKey: 'spikes', support: true, ...KIND_SIZE.spike },
  { id: 'wall', label: '可破坏墙', sprite: 'tile_cracked', arrayKey: 'walls', support: true, ...KIND_SIZE.wall },
  { id: 'stone', label: '石块', sprite: 'tile_block', arrayKey: 'stones', support: true, ...KIND_SIZE.stone },
  { id: 'rig', label: '压力板+升降台', sprite: 'pressure_plate', support: true, ...KIND_SIZE.plate },
  { id: 'platform', label: '平台板', sprite: 'tile_platform_thin', arrayKey: 'ledges', terrain: true, w: TILE_W, h: 1.5 },
  { id: 'ground', label: '一层地块', sprite: 'tile_block', arrayKey: 'ground', terrain: true, w: TILE_W, h: 3 },
];

// --------------------------------------------------------------------------- state + DOM
const state = {
  docs: [] as LevelDoc[],
  docIndex: 0,
  activeTool: 'select' as string,
  selectedId: null as string | null,
  pending: null as Pending | null,
  hover: null as Placement | null,
  images: new Map<string, HTMLImageElement>(),
  failed: new Set<string>(),
  dirty: false,
};

function q<T extends HTMLElement>(sel: string): T {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`missing DOM element: ${sel}`);
  return node as T;
}

const el = {
  canvas: q<HTMLCanvasElement>('#scene'),
  toolList: q<HTMLElement>('#toolList'),
  draftTitle: q<HTMLElement>('#draftTitle'),
  storageHint: q<HTMLElement>('#storageHint'),
  cancelButton: q<HTMLButtonElement>('#cancelButton'),
  pointerReadout: q<HTMLElement>('#pointerReadout'),
  selectionSize: q<HTMLElement>('#selectionSize'),
  draftSelect: q<HTMLSelectElement>('#draftSelect'),
  addDraftButton: q<HTMLButtonElement>('#addDraftButton'),
  cloneDraftButton: q<HTMLButtonElement>('#cloneDraftButton'),
  deleteDraftButton: q<HTMLButtonElement>('#deleteDraftButton'),
  inspectorBody: q<HTMLElement>('#inspectorBody'),
  validationList: q<HTMLElement>('#validationList'),
  playtestButton: q<HTMLButtonElement>('#playtestButton'),
};

const ctx = el.canvas.getContext('2d') as CanvasRenderingContext2D;

// --------------------------------------------------------------------------- doc helpers
function currentDoc(): LevelDoc {
  return state.docs[state.docIndex];
}
function level(): LevelDef {
  return currentDoc().level;
}
function setLevel(next: LevelDef): void {
  currentDoc().level = next;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function persist(): void {
  saveDocs(state.docs);
}
function resetInteraction(): void {
  state.selectedId = null;
  state.pending = null;
  state.hover = null;
}
function setDirty(dirty = true): void {
  state.dirty = dirty;
  currentDoc().name = level().name;
  persist();
  renderAll();
}

// Per-draft "author beat THIS exact level" signatures. The playtest→submit unlock
// (won:true) re-locks automatically on any edit, since the signature changes.
const beaten = new Map<string, string>();
function levelSignature(): string {
  return JSON.stringify(level());
}
function playtestUnlocked(): boolean {
  return beaten.get(currentDoc().id) === levelSignature();
}
function canPlaytest(): boolean {
  return isPlaytestConfigured() && validateLevel(level()).length === 0;
}

// --------------------------------------------------------------------------- pixel geometry
function yFromRow(row: number): number {
  return DESIGN_H - row * CELL;
}
function rectFor(col: number, bottomRow: number, w: number, h: number): Rect {
  return { x: col * CELL, y: yFromRow(bottomRow + h), w: w * CELL, h: h * CELL };
}
function rectBottomRow(rect: Rect): number {
  return (DESIGN_H - (rect.y + rect.h)) / CELL;
}
function canvasPoint(event: MouseEvent): { x: number; y: number; col: number; row: number } {
  const rect = el.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * DESIGN_W;
  const y = ((event.clientY - rect.top) / rect.height) * DESIGN_H;
  return { x, y, col: snapHalf(x / CELL), row: snapHalf((DESIGN_H - y) / CELL) };
}

// --------------------------------------------------------------------------- themes + rigs
function currentThemeName(theme?: ThemeDef): string {
  if (theme) {
    for (const [name, value] of Object.entries(THEMES)) {
      if (JSON.stringify(theme) === JSON.stringify(value)) return name;
    }
  }
  return Object.keys(THEMES)[0] ?? 'indigo';
}
function rigColor(index: number): string {
  return RIG_COLORS[index % RIG_COLORS.length] ?? RIG_COLORS[0];
}
function nextRigColor(def: LevelDef): string {
  return rigColor(def.rigs?.length ?? 0);
}
function ensureRigColors(def: LevelDef): void {
  (def.rigs ?? []).forEach((rig, index) => {
    if (!rig.color) rig.color = rigColor(index);
  });
}

// --------------------------------------------------------------------------- tools
function toolForKind(kind: string): ToolDef {
  if (kind === 'plate') return TOOLS.find((t) => t.id === 'rig')!;
  if (kind === 'lift') return { id: 'lift', label: '升降台', sprite: 'lift', support: true, ...KIND_SIZE.lift };
  if (kind === 'tier2tile') return { id: 'tier2tile', label: '二层平台板', sprite: 'tile_platform_thin', terrain: true, w: TILE_W, h: 1.5 };
  return TOOLS.find((t) => t.id === kind) ?? { id: kind, label: kind, w: 1, h: 1 };
}

// --------------------------------------------------------------------------- sprites
function loadImage(name?: string): void {
  if (!name || state.images.has(name)) return;
  const img = new Image();
  img.onload = () => draw();
  img.onerror = () => {
    state.failed.add(name);
    draw();
  };
  img.src = `${CONFIG.SPRITE_BASE_URL}/${name}.png`;
  state.images.set(name, img);
}

/** Draw a sprite; returns false if the art is not (yet) available. */
function drawSprite(name: string, rect: Rect, alpha = 1, fit: 'contain' | 'width' | 'cover' = 'contain', tint: string | null = null): boolean {
  const img = state.images.get(name);
  if (!img?.complete || !img.naturalWidth) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const scale =
    fit === 'width'
      ? rect.w / img.naturalWidth
      : fit === 'cover'
        ? Math.max(rect.w / img.naturalWidth, rect.h / img.naturalHeight)
        : Math.min(rect.w / img.naturalWidth, rect.h / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + rect.h - h;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, w, h);
  if (tint) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = alpha * 0.42;
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  return true;
}

/** Offline/no-art fallback: a labeled box so the object is still visible + selectable. */
function drawPlaceholder(rect: Rect, name: string, tint: string | null = null): void {
  ctx.save();
  ctx.fillStyle = tint ?? 'rgba(123,90,167,0.35)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = 'rgba(242,238,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx.fillStyle = 'rgba(242,238,255,0.85)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w - 4);
  ctx.restore();
}

function spriteOrPlaceholder(name: string, rect: Rect, alpha = 1, fit: 'contain' | 'width' | 'cover' = 'contain', tint: string | null = null): void {
  loadImage(name);
  if (!drawSprite(name, rect, alpha, fit, tint) && state.failed.has(name)) {
    drawPlaceholder(rect, name, tint ? `${tint}55` : null);
  }
}

// --------------------------------------------------------------------------- drawing primitives
function fillRect(rect: Rect, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}
function strokeRect(rect: Rect, color: string): void {
  ctx.save();
  ctx.lineWidth = BORDER;
  ctx.strokeStyle = color;
  ctx.strokeRect(rect.x + BORDER / 2, rect.y + BORDER / 2, Math.max(1, rect.w - BORDER), Math.max(1, rect.h - BORDER));
  ctx.restore();
}
function drawGrid(): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS * 2; c += 1) {
    const x = (c / 2) * CELL;
    ctx.strokeStyle = c % 2 === 0 ? 'rgba(185,167,219,0.2)' : 'rgba(185,167,219,0.08)';
    ctx.beginPath();
    ctx.moveTo(x, yFromRow(ROWS));
    ctx.lineTo(x, DESIGN_H);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS * 2; r += 1) {
    const y = yFromRow(r / 2);
    ctx.strokeStyle = r % 2 === 0 ? 'rgba(185,167,219,0.2)' : 'rgba(185,167,219,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(DESIGN_W, y);
    ctx.stroke();
  }
  ctx.restore();
}

// --------------------------------------------------------------------------- terrain drawing
function groundRect(obj: any): Rect {
  return rectFor(obj.col, -GROUND_DROP_ROWS, obj.w ?? TILE_W, 3);
}
function tier2TileRect(obj: any): Rect {
  return rectFor(obj.col, (surfaceRowForTier(level(), 2) ?? 0) - 1.5, obj.w ?? TILE_W, 1.5);
}
function platformRect(obj: any): Rect {
  return rectFor(obj.col0, obj.row - 1.5, obj.col1 - obj.col0 + 1, 1.5);
}
function drawGroundTile(tile: any, selected: boolean): void {
  const rect = groundRect(tile);
  fillRect(rect, COLORS.platform);
  ctx.fillStyle = COLORS.platformTop;
  ctx.fillRect(rect.x, rect.y, rect.w, 4);
  loadImage('tile_block');
  drawSprite('tile_block', rect, 1, 'width');
  if (selected) strokeRect(rect, COLORS.selected);
}
function mergeTileSpans(tiles: any[]): { col0: number; col1: number }[] {
  const sorted = [...tiles].sort((a, b) => a.col - b.col);
  const out: { col0: number; col1: number }[] = [];
  for (const tile of sorted) {
    const col1 = tile.col + (tile.w ?? TILE_W) - 1;
    const last = out[out.length - 1];
    if (last && tile.col <= last.col1 + 1) last.col1 = Math.max(last.col1, col1);
    else out.push({ col0: tile.col, col1 });
  }
  return out;
}
function mergedLedges(def: LevelDef): { col0: number; col1: number; row: number }[] {
  const ledges = [...(def.ledges ?? [])].sort((a, b) => a.row - b.row || a.col0 - b.col0);
  const out: { col0: number; col1: number; row: number }[] = [];
  for (const ledge of ledges) {
    const last = out[out.length - 1];
    if (last && last.row === ledge.row && ledge.col0 <= last.col1 + 1) last.col1 = Math.max(last.col1, ledge.col1);
    else out.push({ col0: ledge.col0, col1: ledge.col1, row: ledge.row });
  }
  return out;
}
function drawPlatformSpan(col0: number, col1: number, row: number): void {
  const rect = rectFor(col0, row - 1.5, col1 - col0 + 1, 1.5);
  fillRect(rect, COLORS.platform);
  ctx.fillStyle = COLORS.platformTop;
  ctx.fillRect(rect.x, rect.y, rect.w, 4);
}
function drawTerrain(def: LevelDef): void {
  fillRect({ x: 0, y: 0, w: DESIGN_W, h: DESIGN_H }, def.theme?.void ?? COLORS.void);
  fillRect({ x: 0, y: 0, w: DESIGN_W, h: DESIGN_H }, def.theme?.lower ?? '#17132F');
  fillRect(rectFor(0, 0, 1, ROWS), '#271A45');
  fillRect(rectFor(COLS - 1, 0, 1, ROWS), '#271A45');
  groundTiles(def).forEach((tile, index) => drawGroundTile(tile, state.selectedId === `ground:${index}`));
  mergeTileSpans(tier2Tiles(def)).forEach((span) => drawPlatformSpan(span.col0, span.col1, surfaceRowForTier(def, 2) ?? 0));
  mergedLedges(def).forEach((span) => drawPlatformSpan(span.col0, span.col1, span.row));
  (def.pits ?? []).forEach((pit) => {
    const [a, b] = pitSpan(pit);
    const surface = surfaceRowForTier(def, pit.tier);
    if (surface === null) return;
    const bg = def.theme?.lower ?? '#17132F';
    if (pit.tier === 1) fillRect(rectFor(a, 0, b - a, surface), bg);
    else fillRect(rectFor(a, surface - 1.5, b - a, 1.5), bg);
  });
}

// --------------------------------------------------------------------------- elements (pixel)
function objectRect(def: LevelDef, kind: string, obj: any): Rect | null {
  const tool = toolForKind(kind);
  const w = obj.w ?? tool.w ?? 1;
  const h = obj.h ?? tool.h ?? 1;
  const surface = surfaceRowForTier(def, obj.tier);
  return surface === null ? null : rectFor(obj.col, surface + (obj.dy ?? 0), w, h);
}

function elementsForLevel(def: LevelDef): EditorElement[] {
  const out: (EditorElement | null)[] = [];
  groundTiles(def).forEach((obj, index) =>
    out.push({ id: `ground:${index}`, kind: 'ground', label: `地块 ${index + 1}`, obj, index, arrayKey: 'ground', implicit: !def.ground?.length, rect: groundRect(obj), w: obj.w ?? TILE_W, h: 3 }),
  );
  tier2Tiles(def).forEach((obj, index) =>
    out.push({ id: `tier2tile:${index}`, kind: 'tier2tile', label: `二层平台 ${index + 1}`, obj, index, arrayKey: 'tier2Tiles', implicit: !def.tier2Tiles?.length, rect: tier2TileRect(obj), w: obj.w ?? TILE_W, h: 1.5 }),
  );
  (def.ledges ?? []).forEach((obj, index) =>
    out.push({ id: `platform:${index}`, kind: 'platform', label: `平台 ${index + 1}`, obj, index, arrayKey: 'ledges', rect: platformRect(obj), w: obj.col1 - obj.col0 + 1, h: 1.5 }),
  );
  const pushObj = (id: string, kind: string, obj: any, label: string, sprite: string, singleton = false, arrayKey?: string, index?: number) => {
    const rect = objectRect(def, kind, obj);
    if (rect) out.push({ id, kind, label, obj, sprite, singleton, arrayKey, index, rect });
  };
  pushObj('spawn', 'spawn', def.spawn, '出生点', 'hero', true);
  pushObj('key', 'key', def.key, '钥匙', 'key', true);
  pushObj('door', 'door', def.door, '出口门', 'door_closed', true);
  if (def.bomb) pushObj('bomb', 'bomb', def.bomb, '炸弹', 'bomb', true);
  (def.boxes ?? []).forEach((obj, i) => pushObj(`box:${i}`, 'box', obj, `箱子 ${i + 1}`, 'box', false, 'boxes', i));
  (def.spikes ?? []).forEach((obj, i) => pushObj(`spike:${i}`, 'spike', obj, `尖刺 ${i + 1}`, 'spikes', false, 'spikes', i));
  (def.walls ?? []).forEach((obj, i) => pushObj(`wall:${i}`, 'wall', obj, `墙 ${i + 1}`, 'tile_cracked', false, 'walls', i));
  (def.stones ?? []).forEach((obj, i) => pushObj(`stone:${i}`, 'stone', obj, `石块 ${i + 1}`, 'tile_block', false, 'stones', i));
  (def.rigs ?? []).forEach((rig, index) => {
    const plateRect = objectRect(def, 'rig', rig.plate);
    if (plateRect) out.push({ id: `rig:${index}:plate`, kind: 'plate', label: `压力板 ${index + 1}`, obj: rig.plate, rig, index, sprite: 'pressure_plate', rect: plateRect });
    const surface = surfaceRowForTier(def, rig.lift.restTier);
    if (surface !== null) out.push({ id: `rig:${index}:lift`, kind: 'lift', label: `升降台 ${index + 1}`, obj: rig.lift, rig, index, sprite: 'lift', rect: rectFor(rig.lift.col, surface, rig.lift.w, 1) });
  });
  return out.filter((x): x is EditorElement => x !== null);
}

function drawObjects(def: LevelDef): void {
  const bad = new Set(validateLevel(def).map((x) => x.ref));
  for (const item of elementsForLevel(def)) {
    if (item.kind === 'ground' || item.kind === 'tier2tile' || item.kind === 'platform') {
      if (item.id === state.selectedId) strokeRect(item.rect, bad.has(item.id) ? COLORS.invalid : COLORS.selected);
      continue;
    }
    if (item.sprite) {
      const tint = item.kind === 'plate' || item.kind === 'lift' ? item.rig?.color ?? null : null;
      spriteOrPlaceholder(item.sprite, item.rect, item.kind === 'lift' ? 0.82 : 1, item.kind === 'lift' ? 'width' : 'contain', tint);
    }
    if (item.id === state.selectedId || bad.has(item.id)) strokeRect(item.rect, bad.has(item.id) ? COLORS.invalid : COLORS.selected);
  }
}

function placementRect(pending: Pending, placement: Placement): Rect {
  const kind = pending.kind;
  if (kind === 'ground') return rectFor(placement.col, -GROUND_DROP_ROWS, TILE_W, 3);
  if (kind === 'tier2tile') return rectFor(placement.col, (surfaceRowForTier(level(), 2) ?? 0) - 1.5, TILE_W, 1.5);
  if (kind === 'platform') return rectFor(placement.col, (placement.row ?? 0) - 1.5, TILE_W, 1.5);
  const tool = toolForKind(kind);
  return rectFor(placement.col, placement.surfaceRow ?? placement.row ?? 0, tool.w ?? 1, tool.h ?? 1);
}
function drawHover(): void {
  if (!state.pending || !state.hover) return;
  strokeRect(placementRect(state.pending, state.hover), state.hover.valid ? COLORS.valid : COLORS.invalid);
}
function draw(): void {
  if (!state.docs.length) return;
  drawTerrain(level());
  drawGrid();
  drawObjects(level());
  drawHover();
}

// --------------------------------------------------------------------------- selection + sizing
function selectedItem(): EditorElement | null {
  return elementsForLevel(level()).find((item) => item.id === state.selectedId) ?? null;
}
function itemSize(item: EditorElement): { w: number; h: number } {
  const tool = toolForKind(item.kind);
  if (item.kind === 'platform') return { w: item.obj.col1 - item.obj.col0 + 1, h: 1.5 };
  return { w: item.obj.w ?? item.w ?? tool.w ?? 1, h: item.obj.h ?? item.h ?? tool.h ?? 1 };
}
function hitTest(point: { x: number; y: number }): EditorElement | null {
  return (
    elementsForLevel(level())
      .slice()
      .reverse()
      .find(({ rect }) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) ?? null
  );
}

// --------------------------------------------------------------------------- placement
function terrainPlacementValid(kind: string, col: number, row: number, movingId: string | null = null): boolean {
  const def = level();
  if (kind === 'ground') {
    if (col < 1 || col + TILE_W > COLS - 1) return false;
    return elementsForLevel(def)
      .filter((x) => x.kind === 'ground' && x.id !== movingId)
      .every((x) => !overlaps(col, col + TILE_W, x.obj.col, x.obj.col + (x.obj.w ?? TILE_W)));
  }
  if (kind === 'tier2tile') {
    if (col < 1 || col + TILE_W > COLS - 1) return false;
    return elementsForLevel(def)
      .filter((x) => x.kind === 'tier2tile' && x.id !== movingId)
      .every((x) => !overlaps(col, col + TILE_W, x.obj.col, x.obj.col + (x.obj.w ?? TILE_W)));
  }
  if (kind === 'platform') {
    if (col < 1 || col + TILE_W > COLS - 1 || row <= (surfaceRowForTier(def, 1) ?? 0) + 2 || row >= ROWS - 1) return false;
    return elementsForLevel(def)
      .filter((x) => x.kind === 'platform' && x.id !== movingId)
      .every((x) => x.obj.row !== row || !overlaps(col, col + TILE_W, x.obj.col0, x.obj.col1 + 1));
  }
  return true;
}

function placementFromPointer(point: { col: number; row: number }): Placement | null {
  if (!state.pending) return null;
  const def = level();
  const kind = state.pending.kind;
  const rawCol = point.col - (state.pending.offsetCol ?? 0);
  const rawBottom = point.row - (state.pending.offsetRow ?? 0);
  const movingId = state.pending.itemId ?? null;
  if (kind === 'ground') {
    const col = snapHalf(clamp(rawCol, 1, COLS - 1 - TILE_W));
    return { col, row: -GROUND_DROP_ROWS, valid: terrainPlacementValid(kind, col, -GROUND_DROP_ROWS, movingId) };
  }
  if (kind === 'tier2tile') {
    const t2 = surfaceRowForTier(def, 2) ?? 0;
    const col = snapHalf(clamp(rawCol, 1, COLS - 1 - TILE_W));
    return { col, row: t2, valid: terrainPlacementValid(kind, col, t2, movingId) };
  }
  if (kind === 'platform') {
    const col = snapHalf(clamp(rawCol, 1, COLS - 1 - TILE_W));
    const row = snapHalf(rawBottom + 1.5);
    const tier2Row = surfaceRowForTier(def, 2) ?? 0;
    const asTier2 = Math.abs(row - tier2Row) <= 0.35;
    return {
      col,
      row: asTier2 ? tier2Row : row,
      platformTier: asTier2 ? 2 : 3,
      valid: terrainPlacementValid(asTier2 ? 'tier2tile' : 'platform', col, asTier2 ? tier2Row : row, movingId),
    };
  }
  const tool = toolForKind(kind);
  const col = snapHalf(clamp(rawCol, 1, COLS - (tool.w ?? 1) - 1));
  const bottomRow = snapHalf(rawBottom);
  const support = findPlacementSupport(def, kind, col, tool.w ?? 1, bottomRow, movingId);
  const surfaceRow = support?.surfaceRow ?? bottomRow;
  const blocked = placementOverlapsStackBlocker(def, kind, col, surfaceRow, tool.w ?? 1, tool.h ?? 1, movingId);
  const rigLimitReached = kind === 'rig' && state.pending.mode === 'create' && (def.rigs?.length ?? 0) >= MAX_RIGS;
  return {
    col,
    tier: support?.tier ?? null,
    dy: support?.dy ?? 0,
    surfaceRow,
    valid: Boolean(support) && !blocked && !rigLimitReached,
  };
}

// --------------------------------------------------------------------------- mutations
function makeNewObject(kind: string, placement: Placement): any {
  if (kind === 'ground') return { col: placement.col, w: TILE_W };
  if (kind === 'platform') return { col0: placement.col, col1: placement.col + TILE_W - 1, row: placement.row };
  if (kind === 'tier2tile') return { col: placement.col, w: TILE_W };
  if (kind === 'rig') {
    const hasTier2 = tier2Tiles(level()).length > 0;
    const tier = placement.tier ?? 1;
    const topTier = tier === 1 && hasTier2 ? 2 : Math.min(tier + 1, 3);
    return {
      plate: { col: placement.col, w: 2, tier },
      lift: { col: clamp(placement.col + 4, 1, COLS - 5), w: 3, restTier: tier, topTier },
      color: nextRigColor(level()),
    };
  }
  const dy = placement.dy ? { dy: placement.dy } : {};
  const tier = placement.tier ?? 1;
  if (kind === 'key') return { col: placement.col, tier, w: 1, h: 2, ...dy };
  if (kind === 'door') return { col: placement.col, tier, w: level().door?.w ?? 2, h: level().door?.h ?? 3, ...dy, glow: level().door?.glow ?? [DOOR_GLOW[0], DOOR_GLOW[1]] };
  if (kind === 'bomb') return { col: placement.col, tier, ...dy };
  if (kind === 'spawn') return { col: placement.col, tier };
  if (kind === 'box') return { col: placement.col, tier, ...dy };
  if (kind === 'spike') return { col: placement.col, w: 2, tier, ...dy };
  if (kind === 'wall') return { col: placement.col, w: 3, h: 3, tier };
  if (kind === 'stone') return { col: placement.col, w: 2, tier, ...dy };
  return { col: placement.col, tier };
}
function applyObjectPlacement(obj: any, placement: Placement): void {
  obj.col = placement.col;
  obj.tier = placement.tier;
  if (placement.dy) obj.dy = placement.dy;
  else delete obj.dy;
}
const STACK_SUPPORT_KINDS = new Set(['key', 'bomb', 'door', 'spike', 'box', 'stone']);
function applyMove(item: EditorElement, placement: Placement): void {
  const def = level() as any;
  if (item.implicit && item.kind === 'ground') {
    materializeGround(def);
    item.obj = def.ground[item.index!];
  }
  if (item.implicit && item.kind === 'tier2tile') {
    materializeTier2(def);
    item.obj = def.tier2Tiles[item.index!];
  }
  if (item.kind === 'ground') {
    item.obj.col = placement.col;
    item.obj.w = TILE_W;
  } else if (item.kind === 'tier2tile') {
    item.obj.col = placement.col;
    item.obj.w = TILE_W;
  } else if (item.kind === 'platform') {
    if (placement.platformTier === 2) {
      materializeTier2(def);
      def.tier2Tiles.push({ col: placement.col, w: TILE_W });
      def.ledges.splice(item.index!, 1);
      state.selectedId = `tier2tile:${def.tier2Tiles.length - 1}`;
    } else {
      item.obj.col0 = placement.col;
      item.obj.col1 = placement.col + TILE_W - 1;
      item.obj.row = placement.row;
    }
  } else if (item.kind === 'lift') {
    item.obj.col = placement.col;
    item.obj.restTier = placement.tier;
    item.obj.topTier = Math.max((placement.tier ?? 1) + 1, item.obj.topTier);
  } else if (STACK_SUPPORT_KINDS.has(item.kind)) {
    applyObjectPlacement(item.obj, placement);
  } else {
    item.obj.col = placement.col;
    item.obj.tier = placement.tier;
  }
}

function commitPlacement(): void {
  if (!state.pending || !state.hover?.valid) return;
  const def = level() as any;
  if (state.pending.mode === 'move') {
    const item = selectedItem();
    if (!item) return;
    applyMove(item, state.hover);
  } else {
    const kind = state.pending.kind;
    if (kind === 'platform' && state.hover.platformTier === 2) {
      materializeTier2(def);
      def.tier2Tiles.push(makeNewObject('tier2tile', state.hover));
    } else if (kind === 'ground') {
      materializeGround(def);
      def.ground.push(makeNewObject(kind, state.hover));
    } else if (kind === 'platform') {
      def.ledges ??= [];
      def.ledges.push(makeNewObject(kind, state.hover));
    } else if (kind === 'rig') {
      def.rigs ??= [];
      def.rigs.push(makeNewObject(kind, state.hover));
    } else if (kind === 'spawn') {
      def.spawn = makeNewObject(kind, state.hover);
    } else if (kind === 'key') {
      def.key = makeNewObject(kind, state.hover);
    } else if (kind === 'door') {
      def.door = makeNewObject(kind, state.hover);
    } else if (kind === 'bomb') {
      def.bomb = makeNewObject(kind, state.hover);
    } else {
      const tool = TOOLS.find((t) => t.id === kind);
      if (tool?.arrayKey) {
        def[tool.arrayKey] ??= [];
        def[tool.arrayKey].push(makeNewObject(kind, state.hover));
      }
    }
  }
  resetInteraction();
  state.activeTool = 'select';
  setDirty(true);
}

function cancelDraft(): void {
  if (!state.pending) return;
  if (state.pending.snapshot) {
    setLevel(clone(state.pending.snapshot));
    state.dirty = state.pending.dirtyBefore;
  }
  state.selectedId = state.pending.itemId ?? state.selectedId;
  state.activeTool = 'select';
  state.pending = null;
  state.hover = null;
  renderAll();
}

function deleteSelected(): void {
  const item = selectedItem();
  const def = level() as any;
  if (!item) return;
  if (item.implicit && item.kind === 'ground') materializeGround(def);
  if (item.implicit && item.kind === 'tier2tile') materializeTier2(def);
  if (item.kind === 'ground') def.ground.splice(item.index!, 1);
  else if (item.kind === 'tier2tile') def.tier2Tiles.splice(item.index!, 1);
  else if (item.kind === 'bomb') delete def.bomb;
  else if (item.kind === 'plate' || item.kind === 'lift') def.rigs.splice(item.index!, 1);
  else if (item.arrayKey) def[item.arrayKey].splice(item.index!, 1);
  resetInteraction();
  setDirty(true);
}

function startMove(item: EditorElement, point: { col: number; row: number } | null = null): void {
  const size = itemSize(item);
  const bottom = rectBottomRow(item.rect);
  const left = item.rect.x / CELL;
  state.selectedId = item.id;
  state.activeTool = 'select';
  state.pending = {
    mode: 'move',
    kind: item.kind,
    itemId: item.id,
    offsetCol: point ? point.col - left : size.w / 2,
    offsetRow: point ? point.row - bottom : size.h / 2,
    snapshot: clone(level()),
    dirtyBefore: state.dirty,
  };
  state.hover = null;
  renderAll();
}

function startCreate(kind: string): void {
  if (kind === 'rig' && (level().rigs?.length ?? 0) >= MAX_RIGS) return;
  const tool = toolForKind(kind);
  state.activeTool = kind;
  state.selectedId = null;
  state.pending = { mode: 'create', kind, offsetCol: 0, offsetRow: 0, dirtyBefore: state.dirty, toolW: tool.w, toolH: tool.h };
  state.hover = null;
  renderAll();
}

// --------------------------------------------------------------------------- draft management
function addDraft(): void {
  const lvl = makeDefaultLevel();
  state.docs.push({ id: newDocId(), name: lvl.name, level: lvl });
  state.docIndex = state.docs.length - 1;
  resetInteraction();
  state.dirty = false;
  persist();
  renderAll();
}
function cloneDraft(): void {
  const src = currentDoc();
  const lvl = clone(src.level);
  lvl.name = `${src.name} 副本`;
  state.docs.splice(state.docIndex + 1, 0, { id: newDocId(), name: lvl.name, level: lvl });
  state.docIndex += 1;
  resetInteraction();
  state.dirty = false;
  persist();
  renderAll();
}
function deleteDraft(): void {
  if (state.docs.length <= 1) {
    const lvl = makeDefaultLevel();
    state.docs = [{ id: newDocId(), name: lvl.name, level: lvl }];
    state.docIndex = 0;
  } else {
    state.docs.splice(state.docIndex, 1);
    state.docIndex = Math.min(state.docIndex, state.docs.length - 1);
  }
  resetInteraction();
  state.dirty = false;
  persist();
  renderAll();
}
function selectDraft(index: number): void {
  state.docIndex = clamp(index, 0, state.docs.length - 1);
  resetInteraction();
  state.dirty = false;
  renderAll();
}

// --------------------------------------------------------------------------- inspector UI
function field(label: string, value: string | number, onChange: (v: any) => void, options: { type?: string; select?: { value: string; label: string }[] } = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = options.select ? document.createElement('select') : document.createElement('input');
  if (options.select && input instanceof HTMLSelectElement) {
    for (const opt of options.select) {
      const node = document.createElement('option');
      node.value = opt.value;
      node.textContent = opt.label;
      input.append(node);
    }
    input.value = String(value ?? '');
  } else if (input instanceof HTMLInputElement) {
    input.type = options.type ?? 'text';
    input.value = String(value ?? '');
  }
  input.addEventListener('change', () => {
    onChange(options.select || options.type === 'text' ? input.value : Number(input.value));
    setDirty(true);
  });
  wrap.append(lab, input);
  return wrap;
}
function placedObjectCount(def: LevelDef): number {
  return elementsForLevel(def).filter((item) => !['ground', 'tier2tile', 'platform'].includes(item.kind)).length;
}
function renderInspector(): void {
  el.inspectorBody.innerHTML = '';
  const def = level();
  const card = document.createElement('div');
  card.className = 'inspector-card';

  const head = document.createElement('div');
  head.className = 'level-card-head';
  const title = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = def.name;
  const meta = document.createElement('span');
  meta.textContent = `第 ${state.docIndex + 1} / ${state.docs.length} 个草稿`;
  title.append(name, meta);
  const dirty = document.createElement('span');
  dirty.textContent = state.dirty ? '未保存*' : '已存本地';
  head.append(title, dirty);
  card.append(head);

  const stats = document.createElement('div');
  stats.className = 'level-stats';
  for (const text of [`${def.clones} 分身`, `${currentThemeName(def.theme)} 主题`, `${placedObjectCount(def)} 道具`, `${def.rigs?.length ?? 0}/${MAX_RIGS} 机关`]) {
    const node = document.createElement('span');
    node.className = 'stat';
    node.textContent = text;
    stats.append(node);
  }
  card.append(stats);

  const pt = document.createElement('div');
  pt.className = `playtest-hint${playtestUnlocked() ? ' won' : ''}`;
  pt.textContent = !isPlaytestConfigured()
    ? '试玩：未配置 SANDBOX_URL（部署 Cocos web 构建后可用）'
    : validateLevel(def).length
      ? '试玩：修正校验问题后可试玩'
      : playtestUnlocked()
        ? '✓ 已在真机通关 · 可投稿（M4）'
        : '可试玩 —— 真机通关后解锁投稿（M4）';
  card.append(pt);

  if (def.rigs?.length) {
    const palette = document.createElement('div');
    palette.className = 'rig-palette';
    def.rigs.forEach((rig, index) => {
      const chip = document.createElement('span');
      chip.className = 'rig-chip';
      chip.style.setProperty('--rig-color', rig.color ?? rigColor(index));
      chip.textContent = `机关 ${index + 1}`;
      palette.append(chip);
    });
    card.append(palette);
  }

  card.append(
    field('关卡名', def.name, (v) => {
      def.name = String(v);
    }, { type: 'text' }),
    field('分身数', def.clones, (v) => {
      def.clones = Math.max(0, Math.min(2, Math.round(Number(v))));
    }, { type: 'number' }),
    field('背景主题', currentThemeName(def.theme), (v) => {
      def.theme = { ...(THEMES[String(v)] ?? THEMES.indigo) };
    }, { select: Object.keys(THEMES).map((name) => ({ value: name, label: name })) }),
  );

  const item = selectedItem();
  if (item) {
    const selection = document.createElement('div');
    selection.className = 'selection-panel';
    const size = itemSize(item);
    const sizeNode = document.createElement('div');
    sizeNode.className = 'hint';
    sizeNode.textContent = `选中：${item.label} · ${size.w} × ${size.h} 格`;
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '删除';
    del.addEventListener('click', deleteSelected);
    actions.append(del);
    selection.append(sizeNode, actions);
    card.append(selection);
  }
  el.inspectorBody.append(card);
}

function renderDrafts(): void {
  el.draftSelect.innerHTML = '';
  state.docs.forEach((doc, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${doc.level.name || doc.name}`;
    el.draftSelect.append(option);
  });
  el.draftSelect.value = String(state.docIndex);
  el.deleteDraftButton.disabled = false;
}

function spriteSwatch(sprite?: string, rigColorValue?: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'swatch';
  if (!sprite) {
    span.style.background = rigColorValue ?? COLORS.platform;
    return span;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.src = `${CONFIG.SPRITE_BASE_URL}/${sprite}.png`;
  img.addEventListener('error', () => {
    span.classList.add('missing');
    span.textContent = sprite;
  });
  span.append(img);
  return span;
}
function renderTools(): void {
  el.toolList.innerHTML = '';
  for (const tool of TOOLS) {
    const isRig = tool.id === 'rig';
    const rigFull = isRig && (level().rigs?.length ?? 0) >= MAX_RIGS;
    const button = document.createElement('button');
    button.className = `tool-item ${state.activeTool === tool.id ? 'active' : ''} ${isRig ? 'rig-tool' : ''}`.trim();
    button.disabled = rigFull;
    if (isRig) button.style.setProperty('--rig-color', nextRigColor(level()));
    const meta = isRig ? `板 ${tool.w} × ${tool.h} / 台 3 × 1` : `${tool.w} × ${tool.h} 格`;
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = tool.label;
    const metaNode = document.createElement('div');
    metaNode.className = 'tool-meta';
    metaNode.textContent = rigFull ? `${MAX_RIGS}/${MAX_RIGS} 组` : meta;
    text.append(strong, metaNode);
    button.append(spriteSwatch(tool.sprite), text);
    button.addEventListener('click', () => startCreate(tool.id));
    el.toolList.append(button);
  }
}

function renderValidation(): void {
  const issues = validateLevel(level());
  el.validationList.innerHTML = '';
  if (!issues.length) {
    const ok = document.createElement('div');
    ok.className = 'issue ok';
    ok.textContent = '当前关卡通过校验（结构合法，不代表可通关）';
    el.validationList.append(ok);
    return;
  }
  for (const issue of issues) {
    const node = document.createElement('button');
    node.className = 'issue bad';
    node.textContent = issue.reason;
    node.addEventListener('click', () => {
      const item = elementsForLevel(level()).find((x) => x.id === issue.ref);
      if (item) startMove(item);
    });
    el.validationList.append(node);
  }
}

function renderStatus(): void {
  const item = selectedItem();
  const size = item
    ? itemSize(item)
    : state.pending
      ? { w: state.pending.toolW ?? toolForKind(state.pending.kind).w, h: state.pending.toolH ?? toolForKind(state.pending.kind).h }
      : null;
  el.selectionSize.textContent = size ? `尺寸：${size.w} × ${size.h} 格` : '未选中';
}

function renderHeader(): void {
  el.draftTitle.textContent = `${level().name}${state.dirty ? ' *' : ''}`;
  el.storageHint.textContent = '本地草稿 · localStorage（不写游戏源码）';
  el.cancelButton.hidden = !state.pending;
}

function renderActions(): void {
  const configured = isPlaytestConfigured();
  const valid = validateLevel(level()).length === 0;
  el.playtestButton.disabled = !(configured && valid);
  el.playtestButton.textContent = playtestUnlocked() ? '重玩 ✓' : '试玩';
  el.playtestButton.title = !configured
    ? '未配置 VITE_SANDBOX_URL（游戏 web 构建端点）'
    : !valid
      ? '先修正校验问题再试玩'
      : '在真实引擎沙箱里试玩本关（通关后解锁投稿）';
}

function renderAll(): void {
  if (!state.docs.length) return;
  renderHeader();
  renderActions();
  renderDrafts();
  renderTools();
  renderInspector();
  renderValidation();
  renderStatus();
  draw();
}

// --------------------------------------------------------------------------- events + init
function wireEvents(): void {
  el.canvas.addEventListener('mousemove', (event) => {
    const point = canvasPoint(event);
    el.pointerReadout.textContent = `col ${point.col.toFixed(1)}, row ${point.row.toFixed(1)}`;
    state.hover = placementFromPointer(point);
    draw();
  });
  el.canvas.addEventListener('mouseleave', () => {
    state.hover = null;
    draw();
  });
  el.canvas.addEventListener('click', (event) => {
    const point = canvasPoint(event);
    if (state.pending) {
      state.hover = placementFromPointer(point);
      commitPlacement();
      return;
    }
    const hit = hitTest(point);
    if (hit) startMove(hit, point);
    else {
      state.selectedId = null;
      renderAll();
    }
  });
  el.cancelButton.addEventListener('click', cancelDraft);
  el.playtestButton.addEventListener('click', () => {
    if (!canPlaytest()) return;
    const id = currentDoc().id;
    const sig = levelSignature();
    openPlaytest(clone(level()), {
      onResult: (won) => {
        if (won) beaten.set(id, sig);
        renderAll();
      },
    });
  });
  el.draftSelect.addEventListener('change', () => selectDraft(Number(el.draftSelect.value)));
  el.addDraftButton.addEventListener('click', addDraft);
  el.cloneDraftButton.addEventListener('click', cloneDraft);
  el.deleteDraftButton.addEventListener('click', () => {
    if (window.confirm(`删除草稿「${level().name}」？`)) deleteDraft();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancelDraft();
  });
}

export function initEditor(): void {
  wireEvents();
  let docs = loadDocs();
  if (!docs.length) {
    const lvl = makeDefaultLevel();
    docs = [{ id: newDocId(), name: lvl.name, level: lvl }];
  }
  docs.forEach((d) => ensureRigColors(d.level));
  state.docs = docs;
  state.docIndex = 0;
  resetInteraction();
  state.dirty = false;
  renderAll();
}
