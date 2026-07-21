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
 * UI layer (2026 redesign): the canvas interaction, placement, mutation and draft logic
 * below is unchanged; the surrounding DOM was rebuilt as a "paper drafting table" workbench:
 *   - `./toolCatalog` is the single registration point for placeable tools (grouped by
 *     category in the left library — add one entry there to add a prop).
 *   - The right inspector is split into Selection / Level / Validation / Publish panels;
 *     the Publish panel owns the visible playtest→export gating and the future level-
 *     submission entry point (currently a "coming soon" dialog, no network).
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
import { MAX_LEVEL_JSON_BYTES, exportFilename, parseLevelJson, serializeLevelEnvelope } from './levelFiles';
import { openPlaytest, isPlaytestConfigured } from './playtestEmbed';
import { TOOL_CATEGORIES, TOOLS, toolForKind } from './toolCatalog';

// --------------------------------------------------------------------------- types
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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

/** Kinds that are mandatory for a playable level — selectable/movable but not deletable. */
const REQUIRED_KINDS = new Set(['spawn', 'key', 'door']);

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
  storageError: null as string | null,
  fileNotice: null as string | null,
  fileNoticeError: false,
  savedAt: null as Date | null,
  /** Value of the notice text the user dismissed; a NEW notice re-shows the bar. */
  dismissedNotice: null as string | null,
};

function q<T extends HTMLElement>(sel: string): T {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`missing DOM element: ${sel}`);
  return node as T;
}

const el = {
  canvas: q<HTMLCanvasElement>('#scene'),
  toolLibrary: q<HTMLElement>('#toolLibrary'),
  draftSelect: q<HTMLSelectElement>('#draftSelect'),
  saveState: q<HTMLElement>('#saveState'),
  saveText: q<HTMLElement>('#saveText'),
  addDraftButton: q<HTMLButtonElement>('#addDraftButton'),
  cloneDraftButton: q<HTMLButtonElement>('#cloneDraftButton'),
  deleteDraftButton: q<HTMLButtonElement>('#deleteDraftButton'),
  importButton: q<HTMLButtonElement>('#importButton'),
  importFileInput: q<HTMLInputElement>('#importFileInput'),
  playtestButton: q<HTMLButtonElement>('#playtestButton'),
  noticeBar: q<HTMLElement>('#noticeBar'),
  noticeText: q<HTMLElement>('#noticeText'),
  noticeClose: q<HTMLButtonElement>('#noticeClose'),
  modeChip: q<HTMLElement>('#modeChip'),
  modeText: q<HTMLElement>('#modeText'),
  cancelButton: q<HTMLButtonElement>('#cancelButton'),
  pointerReadout: q<HTMLElement>('#pointerReadout'),
  selectionSize: q<HTMLElement>('#selectionSize'),
  selectionBody: q<HTMLElement>('#selectionBody'),
  levelBody: q<HTMLElement>('#levelBody'),
  validationCount: q<HTMLElement>('#validationCount'),
  validationList: q<HTMLElement>('#validationList'),
  publishSteps: q<HTMLElement>('#publishSteps'),
  exportButton: q<HTMLButtonElement>('#exportButton'),
  exportHint: q<HTMLElement>('#exportHint'),
  submitButton: q<HTMLButtonElement>('#submitButton'),
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
function persist(): boolean {
  const result = saveDocs(state.docs);
  state.storageError = result.ok ? null : result.error ?? '本地保存失败';
  if (result.ok) state.savedAt = new Date();
  return result.ok;
}
function resetInteraction(): void {
  state.selectedId = null;
  state.pending = null;
  state.hover = null;
}
function setDirty(dirty = true): void {
  state.dirty = dirty;
  state.fileNotice = null;
  state.fileNoticeError = false;
  currentDoc().name = level().name;
  if (dirty) state.dirty = !persist();
  renderAll();
}

// Per-draft "author beat THIS exact level" signatures. The playtest→export unlock
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
  if (REQUIRED_KINDS.has(item.kind)) return;
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
  state.dirty = !persist();
  renderAll();
}
function cloneDraft(): void {
  const src = currentDoc();
  const lvl = clone(src.level);
  lvl.name = `${src.name} 副本`;
  // A clone is a new draft, not permission to overwrite the imported official id.
  state.docs.splice(state.docIndex + 1, 0, { id: newDocId(), name: lvl.name, level: lvl });
  state.docIndex += 1;
  resetInteraction();
  state.dirty = false;
  state.dirty = !persist();
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
  state.dirty = !persist();
  renderAll();
}
function selectDraft(index: number): void {
  state.docIndex = clamp(index, 0, state.docs.length - 1);
  resetInteraction();
  state.dirty = false;
  renderAll();
}

async function importSelectedFile(): Promise<void> {
  const file = el.importFileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_LEVEL_JSON_BYTES) throw new Error('关卡 JSON 超过 1 MB 限制');
    const imported = parseLevelJson(await file.text(), file.name);
    ensureRigColors(imported.level);
    state.docs.push({
      id: newDocId(),
      name: imported.level.name,
      level: imported.level,
      sourceId: imported.sourceId,
    });
    state.docIndex = state.docs.length - 1;
    resetInteraction();
    state.dirty = !persist();
    state.fileNoticeError = false;
    state.fileNotice = imported.issues.length
      ? `已导入 ${file.name}，请修正 ${imported.issues.length} 项校验问题后再试玩`
      : `已导入 ${file.name}${imported.sourceId ? ` · 来源 ${imported.sourceId}` : ''}`;
  } catch (error) {
    state.fileNoticeError = true;
    state.fileNotice = `导入失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    // Allow selecting the same file again after fixing it externally.
    el.importFileInput.value = '';
    renderAll();
  }
}

function exportCurrentDraft(): void {
  if (validateLevel(level()).length || !playtestUnlocked()) return;
  try {
    const filename = exportFilename(currentDoc().sourceId, level().name);
    const blob = new Blob([serializeLevelEnvelope(level())], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    state.fileNoticeError = false;
    state.fileNotice = `已导出 ${filename} · 写入 levels 分支仍需维护者审核`;
  } catch (error) {
    state.fileNoticeError = true;
    state.fileNotice = `导出失败：${error instanceof Error ? error.message : String(error)}`;
  }
  renderAll();
}

// --------------------------------------------------------------------------- dialogs
interface DialogAction {
  label: string;
  className: string;
  onClick?: () => void;
}
interface ActiveDialog {
  overlay: HTMLElement;
  panel: HTMLElement;
  opener: HTMLElement | null;
}
let activeDialog: ActiveDialog | null = null;

function closeDialog(): void {
  if (!activeDialog) return;
  activeDialog.overlay.remove();
  const opener = activeDialog.opener;
  activeDialog = null;
  opener?.focus();
}

/**
 * Minimal modal dialog (delete-draft confirm, submission placeholder). Esc / backdrop
 * click closes; focus is trapped in the panel and restored to the opener afterwards.
 */
function openDialog(title: string, build: (body: HTMLElement) => void, actions: DialogAction[]): void {
  closeDialog();
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  const panel = document.createElement('div');
  panel.className = 'dialog-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  const head = document.createElement('h3');
  head.className = 'dialog-title';
  head.textContent = title;
  const body = document.createElement('div');
  body.className = 'dialog-body';
  build(body);
  const foot = document.createElement('div');
  foot.className = 'dialog-actions';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.className;
    button.textContent = action.label;
    button.addEventListener('click', () => {
      closeDialog();
      action.onClick?.();
    });
    foot.append(button);
  }
  panel.append(head, body, foot);
  overlay.append(panel);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeDialog();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  });
  activeDialog = { overlay, panel, opener: document.activeElement as HTMLElement | null };
  document.body.append(overlay);
  (foot.querySelector('button') ?? panel).focus();
}

function confirmDeleteDraft(): void {
  openDialog(
    '删除草稿',
    (body) => {
      body.textContent = `删除草稿「${level().name}」？此操作只影响本地草稿，且不可撤销。`;
    },
    [
      { label: '取消', className: 'btn btn-sm btn-ghost' },
      { label: '删除', className: 'btn btn-sm btn-danger', onClick: deleteDraft },
    ],
  );
}

/** Future submission entry — intentionally a static dialog: no network, no fake state. */
function openSubmitDialog(): void {
  const valid = validateLevel(level()).length === 0;
  const unlocked = playtestUnlocked();
  openDialog(
    '投稿关卡',
    (body) => {
      const intro = document.createElement('p');
      intro.style.margin = '0';
      intro.textContent = '投稿功能正在开发中，敬请期待。未来你的关卡将通过以下流程进入社区：';
      const list = document.createElement('ol');
      for (const text of [
        `修正结构问题，通过校验${valid ? '（已完成 ✓）' : '（当前还有未解决的问题）'}`,
        `在真实沙箱中试玩并通关${unlocked ? '（已完成 ✓）' : '（尚未完成）'}`,
        '提交投稿，等待维护者审核（即将开放）',
      ]) {
        const item = document.createElement('li');
        item.textContent = text;
        list.append(item);
      }
      const note = document.createElement('p');
      note.style.margin = '10px 0 0';
      note.textContent = '现阶段可以使用「导出关卡 JSON」保存作品，或把文件分享给维护者。';
      body.append(intro, list, note);
    },
    [{ label: '我知道了', className: 'btn btn-sm btn-ink' }],
  );
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

// ---------- topbar: draft switcher + save state ----------
function renderTopbar(): void {
  el.draftSelect.innerHTML = '';
  state.docs.forEach((doc, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${doc.sourceId ? `[${doc.sourceId}] ` : ''}${doc.level.name || doc.name}`;
    el.draftSelect.append(option);
  });
  el.draftSelect.value = String(state.docIndex);

  if (state.storageError) {
    el.saveState.dataset.state = 'error';
    el.saveText.textContent = '保存失败 · 将自动重试';
  } else {
    el.saveState.dataset.state = 'saved';
    const time = state.savedAt?.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
    el.saveText.textContent = time ? `已自动保存 ${time}` : '已自动保存';
  }
}

// ---------- notice bar: storage errors + import/export feedback ----------
function renderNotice(): void {
  const text = state.storageError ?? state.fileNotice;
  const isError = Boolean(state.storageError) || state.fileNoticeError;
  if (!text || text === state.dismissedNotice) {
    el.noticeBar.hidden = true;
    return;
  }
  el.noticeBar.hidden = false;
  el.noticeBar.dataset.kind = isError ? 'error' : 'info';
  el.noticeText.textContent = text;
}

// ---------- tool library (grouped by toolCatalog categories) ----------
function spriteSwatch(sprite?: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'tool-swatch';
  if (sprite) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `${CONFIG.SPRITE_BASE_URL}/${sprite}.png`;
    img.addEventListener('error', () => {
      span.classList.add('missing');
      span.textContent = sprite;
    });
    span.append(img);
  }
  return span;
}

function renderToolLibrary(): void {
  el.toolLibrary.innerHTML = '';
  const rigCount = level().rigs?.length ?? 0;
  for (const category of TOOL_CATEGORIES) {
    const tools = TOOLS.filter((tool) => tool.category === category.id);
    if (!tools.length) continue;
    const group = document.createElement('div');
    group.className = 'tool-group';
    const head = document.createElement('div');
    head.className = 'tool-group-head';
    const title = document.createElement('h3');
    title.textContent = category.label;
    const en = document.createElement('span');
    en.className = 'tool-group-en';
    en.textContent = category.en;
    head.append(title, en);
    group.append(head);

    for (const tool of tools) {
      const isRig = tool.id === 'rig';
      const rigFull = isRig && rigCount >= MAX_RIGS;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tool-item${state.activeTool === tool.id ? ' active' : ''}`;
      button.disabled = rigFull;
      button.setAttribute('aria-pressed', state.activeTool === tool.id ? 'true' : 'false');

      const text = document.createElement('span');
      text.className = 'tool-text';
      const strong = document.createElement('strong');
      strong.textContent = tool.label;
      const meta = document.createElement('span');
      meta.className = 'tool-meta';
      if (isRig) {
        const dot = document.createElement('span');
        dot.className = 'rig-dot';
        dot.style.setProperty('--rig-color', nextRigColor(level()));
        meta.append(dot, document.createTextNode(rigFull ? `已达上限 ${MAX_RIGS}/${MAX_RIGS} 组` : `板 ${tool.w}×${tool.h} / 台 3×1 · 已建 ${rigCount}/${MAX_RIGS} 组`));
      } else {
        meta.textContent = `${tool.w} × ${tool.h} 格`;
      }
      const hint = document.createElement('span');
      hint.className = 'tool-hint';
      hint.textContent = rigFull ? '删除一组机关后可再次放置' : tool.hint;
      text.append(strong, meta, hint);
      button.append(spriteSwatch(tool.sprite), text);
      button.addEventListener('click', () => startCreate(tool.id));
      group.append(button);
    }
    el.toolLibrary.append(group);
  }

  // Placeholder for future props — a visible slot, not a fake feature.
  const soon = document.createElement('div');
  soon.className = 'coming-soon';
  soon.textContent = '更多道具正在设计中，后续会直接加入上方对应分类。';
  const soonEn = document.createElement('span');
  soonEn.className = 'soon-en';
  soonEn.textContent = 'MORE PROPS · COMING SOON';
  soon.append(soonEn);
  el.toolLibrary.append(soon);
}

// ---------- mode bar: what is the canvas doing right now ----------
function renderModeBar(): void {
  const pending = state.pending;
  el.cancelButton.hidden = !pending;
  if (!pending) {
    const item = selectedItem();
    el.modeChip.dataset.mode = 'select';
    el.modeChip.textContent = '选择';
    el.modeText.removeAttribute('data-valid');
    el.modeText.textContent = item
      ? `已选中「${item.label}」— 点击物件开始移动，或按 Delete 删除`
      : '点击画布中的物件进行选择或移动；从左侧道具库选择道具后放置';
    return;
  }
  const tool = toolForKind(pending.kind);
  const moving = pending.mode === 'move' ? selectedItem() : null;
  const label = moving?.label ?? tool.label;
  el.modeChip.dataset.mode = pending.mode === 'create' ? 'place' : 'move';
  el.modeChip.textContent = pending.mode === 'create' ? '放置' : '移动';
  let text = pending.mode === 'create' ? `正在放置「${label}」— 点击画布放下，Esc 取消` : `正在移动「${label}」— 点击新位置放下，Esc 还原`;
  if (state.hover) {
    text += state.hover.valid ? ' · 当前位置可放置 ✓' : ' · 当前位置不可放置 ✕';
    el.modeText.dataset.valid = state.hover.valid ? 'ok' : 'bad';
  } else {
    el.modeText.removeAttribute('data-valid');
  }
  el.modeText.textContent = text;
}

// ---------- selection panel ----------
function renderSelection(): void {
  el.selectionBody.innerHTML = '';
  const item = selectedItem();
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'sel-empty';
    const lead = document.createElement('strong');
    lead.textContent = '未选中任何物件';
    empty.append(
      lead,
      document.createElement('br'),
      document.createTextNode('· 点击画布中的物件进行选择或移动'),
      document.createElement('br'),
      document.createTextNode('· 从左侧道具库选择道具，在画布放置'),
      document.createElement('br'),
      document.createTextNode('· Esc 取消放置 · Delete 删除选中'),
    );
    el.selectionBody.append(empty);
    return;
  }
  const size = itemSize(item);
  const head = document.createElement('div');
  head.className = 'sel-card-head';
  const name = document.createElement('strong');
  name.textContent = item.label;
  const kind = document.createElement('span');
  kind.className = 'sel-kind';
  kind.textContent = item.kind;
  head.append(name, kind);

  const meta = document.createElement('div');
  meta.className = 'sel-meta';
  const colText = item.kind === 'platform' ? `col ${item.obj.col0}–${item.obj.col1}` : `col ${item.obj.col}`;
  const tierText = item.kind === 'ground' || item.kind === 'tier2tile' || item.kind === 'platform' ? `row ${item.obj.row ?? '—'}` : `tier ${item.obj.tier ?? item.obj.restTier ?? '—'}`;
  meta.append(document.createTextNode(`尺寸 ${size.w} × ${size.h} 格`), document.createElement('br'), document.createTextNode(`位置 ${colText} · ${tierText}`));

  el.selectionBody.append(head, meta);

  if (REQUIRED_KINDS.has(item.kind)) {
    const note = document.createElement('div');
    note.className = 'sel-note';
    note.textContent = '必需元素 · 不可删除，点击画布可直接移动位置';
    el.selectionBody.append(note);
  } else {
    const actions = document.createElement('div');
    actions.className = 'sel-actions';
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'btn btn-sm';
    move.textContent = '移动';
    move.addEventListener('click', () => startMove(item));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-sm btn-danger';
    del.textContent = '删除';
    del.addEventListener('click', deleteSelected);
    actions.append(move, del);
    el.selectionBody.append(actions);
  }
}

// ---------- level panel ----------
function renderLevelCard(): void {
  el.levelBody.innerHTML = '';
  const def = level();

  el.levelBody.append(
    field('关卡名', def.name, (v) => {
      def.name = String(v);
    }, { type: 'text' }),
    field('分身数量（0–2）', def.clones, (v) => {
      def.clones = Math.max(0, Math.min(2, Math.round(Number(v))));
    }, { type: 'number' }),
    field('背景主题', currentThemeName(def.theme), (v) => {
      def.theme = { ...(THEMES[String(v)] ?? THEMES.indigo) };
    }, { select: Object.keys(THEMES).map((name) => ({ value: name, label: name })) }),
  );

  const stats = document.createElement('div');
  stats.className = 'stat-chips';
  const chips = [`道具 ${placedObjectCount(def)}`, `机关 ${def.rigs?.length ?? 0}/${MAX_RIGS}`, `分身 ${def.clones}`];
  if (currentDoc().sourceId) chips.push(`来源 ${currentDoc().sourceId}`);
  for (const text of chips) {
    const node = document.createElement('span');
    node.className = 'stat';
    node.textContent = text;
    stats.append(node);
  }
  el.levelBody.append(stats);

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
    el.levelBody.append(palette);
  }
}

// ---------- validation panel ----------
function renderValidation(): void {
  const issues = validateLevel(level());
  el.validationList.innerHTML = '';
  el.validationCount.hidden = !issues.length;
  el.validationCount.textContent = String(issues.length);
  if (!issues.length) {
    const ok = document.createElement('div');
    ok.className = 'issue-ok';
    ok.textContent = '✓ 结构合法 · 通过 validateLevel 校验';
    const note = document.createElement('p');
    note.className = 'issue-note';
    note.textContent = '结构合法 ≠ 一定可以通关 —— 需要在真实沙箱里试玩验证。';
    el.validationList.append(ok, note);
    return;
  }
  for (const issue of issues) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'issue';
    node.textContent = issue.reason;
    const hint = document.createElement('small');
    hint.textContent = '点击定位并调整对应物件';
    node.append(hint);
    node.addEventListener('click', () => {
      const item = elementsForLevel(level()).find((x) => x.id === issue.ref);
      if (item) startMove(item);
    });
    el.validationList.append(node);
  }
}

// ---------- publish panel: visible gating for playtest / export / submission ----------
function renderPublish(): void {
  const configured = isPlaytestConfigured();
  const issueCount = validateLevel(level()).length;
  const valid = issueCount === 0;
  const unlocked = playtestUnlocked();

  const steps: { title: string; sub: string; state: 'done' | 'current' | 'blocked' }[] = [
    {
      title: '结构校验通过',
      sub: valid ? 'validateLevel 无待解决问题' : `还有 ${issueCount} 项问题 — 点击上方校验列表定位`,
      state: valid ? 'done' : 'current',
    },
    {
      title: '真实试玩并通关',
      sub: !configured
        ? '未配置试玩沙箱（VITE_SANDBOX_URL），部署 Cocos 构建后可用'
        : !valid
          ? '需先通过结构校验'
          : unlocked
            ? '已在真实引擎中通关当前内容'
            : '点击右上角「试玩」；修改关卡后需重新通关',
      state: unlocked ? 'done' : valid && configured ? 'current' : 'blocked',
    },
    {
      title: '投稿审核 · 敬请期待',
      sub: '投稿通道开发中；当前可导出 JSON 交给维护者',
      state: 'blocked',
    },
  ];

  el.publishSteps.innerHTML = '';
  steps.forEach((step, index) => {
    const li = document.createElement('li');
    li.className = 'step';
    li.dataset.state = step.state;
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = String(index + 1);
    const body = document.createElement('div');
    body.className = 'step-body';
    const title = document.createElement('strong');
    title.textContent = step.title;
    const sub = document.createElement('div');
    sub.className = 'step-sub';
    sub.textContent = step.sub;
    body.append(title, sub);
    li.append(num, body);
    el.publishSteps.append(li);
  });

  el.exportButton.disabled = !(valid && unlocked);
  el.exportHint.textContent = !valid
    ? '导出前需通过结构校验。'
    : !unlocked
      ? '导出前需在真实沙箱中通关当前内容；任何修改都会重新锁定导出。'
      : '已通过真实试玩验证 · 可导出标准 LevelEnvelope JSON。';
}

// ---------- topbar playtest action ----------
function renderActions(): void {
  const configured = isPlaytestConfigured();
  const valid = validateLevel(level()).length === 0;
  el.playtestButton.disabled = !(configured && valid);
  el.playtestButton.textContent = playtestUnlocked() ? '重玩 ✓' : '试玩';
  el.playtestButton.title = !configured
    ? '未配置 VITE_SANDBOX_URL（游戏 web 构建端点）'
    : !valid
      ? '先修正校验问题再试玩（原因见右侧「发布准备」）'
      : '在真实引擎沙箱里试玩本关（通关后解锁导出）';
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

function renderAll(): void {
  if (!state.docs.length) return;
  renderTopbar();
  renderNotice();
  renderActions();
  renderToolLibrary();
  renderModeBar();
  renderSelection();
  renderLevelCard();
  renderValidation();
  renderPublish();
  renderStatus();
  draw();
}

// --------------------------------------------------------------------------- events + init
function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
}

function wireEvents(): void {
  el.canvas.addEventListener('mousemove', (event) => {
    const point = canvasPoint(event);
    el.pointerReadout.textContent = `col ${point.col.toFixed(1)}, row ${point.row.toFixed(1)}`;
    state.hover = placementFromPointer(point);
    if (state.pending) renderModeBar();
    draw();
  });
  el.canvas.addEventListener('mouseleave', () => {
    state.hover = null;
    if (state.pending) renderModeBar();
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
  el.importButton.addEventListener('click', () => el.importFileInput.click());
  el.importFileInput.addEventListener('change', () => void importSelectedFile());
  el.exportButton.addEventListener('click', exportCurrentDraft);
  el.submitButton.addEventListener('click', openSubmitDialog);
  el.noticeClose.addEventListener('click', () => {
    state.dismissedNotice = state.storageError ?? state.fileNotice;
    renderNotice();
  });
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
  el.deleteDraftButton.addEventListener('click', confirmDeleteDraft);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activeDialog) closeDialog();
      else cancelDraft();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !activeDialog && !isFormTarget(event.target)) {
      deleteSelected();
    }
  });
}

export function initEditor(): void {
  wireEvents();
  const loaded = loadDocs();
  let docs = loaded.docs;
  if (!docs.length) {
    const lvl = makeDefaultLevel();
    docs = [{ id: newDocId(), name: lvl.name, level: lvl }];
  }
  docs.forEach((d) => ensureRigColors(d.level));
  state.docs = docs;
  state.docIndex = 0;
  state.storageError = loaded.warning ?? null;
  resetInteraction();
  state.dirty = false;
  renderAll();
}
