/**
 * Tool catalog — the single place to register editor placeables.
 *
 * Adding a new prop/terrain means appending ONE entry to `TOOLS` here (footprint sizes
 * still come from @10s/schema `KIND_SIZE`; terrain tile sizes from `TILE_W`). The tool
 * library UI groups entries by `category` automatically — no DOM or CSS changes needed.
 * Placement / validation logic stays in `editor.ts` + `@10s/schema`.
 */
import { KIND_SIZE, TILE_W } from '@10s/schema';

export interface ToolCategory {
  id: string;
  label: string;
  /** Mono English microcopy shown next to the Chinese label (brand voice). */
  en: string;
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  { id: 'required', label: '关卡必需', en: 'REQUIRED' },
  { id: 'terrain', label: '地形结构', en: 'TERRAIN' },
  { id: 'mechanism', label: '机关', en: 'RIGS' },
  { id: 'hazard', label: '障碍与危险', en: 'HAZARDS' },
  { id: 'prop', label: '可交互道具', en: 'PROPS' },
];

export interface ToolDef {
  id: string;
  label: string;
  sprite?: string;
  singleton?: boolean;
  arrayKey?: string;
  w: number;
  h: number;
  support?: boolean;
  terrain?: boolean;
  /** Toolbox grouping — see TOOL_CATEGORIES. */
  category: string;
  /** One-line functional hint shown under the tool name. */
  hint: string;
}

// Footprint sizes for OBJECT kinds come from schema `KIND_SIZE` (single source of truth);
// terrain kinds (ground/platform) are editor-only tile sizes.
export const TOOLS: ToolDef[] = [
  { id: 'spawn', label: '出生点', sprite: 'hero', singleton: true, support: true, category: 'required', hint: '所有分身与真身的唯一起点', ...KIND_SIZE.spawn },
  { id: 'key', label: '钥匙', sprite: 'key', singleton: true, support: true, category: 'required', hint: '开门必需，仅一把', ...KIND_SIZE.key },
  { id: 'door', label: '出口门', sprite: 'door_closed', singleton: true, support: true, category: 'required', hint: '通关终点', ...KIND_SIZE.door },
  { id: 'ground', label: '一层地块', sprite: 'tile_block', arrayKey: 'ground', terrain: true, category: 'terrain', hint: '3 格一组，可拼出缺口', w: TILE_W, h: 3 },
  { id: 'platform', label: '平台板', sprite: 'tile_platform_thin', arrayKey: 'ledges', terrain: true, category: 'terrain', hint: '悬浮板，靠近二层时自动吸附', w: TILE_W, h: 1.5 },
  { id: 'rig', label: '压力板+升降台', sprite: 'pressure_plate', support: true, category: 'mechanism', hint: '成组放置，有数量上限', ...KIND_SIZE.plate },
  { id: 'spike', label: '尖刺', sprite: 'spikes', arrayKey: 'spikes', support: true, category: 'hazard', hint: '致命，阻挡通行', ...KIND_SIZE.spike },
  { id: 'wall', label: '可破坏墙', sprite: 'tile_cracked', arrayKey: 'walls', support: true, category: 'hazard', hint: '可被炸弹摧毁', ...KIND_SIZE.wall },
  { id: 'stone', label: '石块', sprite: 'tile_block', arrayKey: 'stones', support: true, category: 'hazard', hint: '可攀爬，可叠放垫脚', ...KIND_SIZE.stone },
  { id: 'bomb', label: '炸弹', sprite: 'bomb', singleton: true, support: true, category: 'prop', hint: '可搬运，炸开可破坏墙', ...KIND_SIZE.bomb },
  { id: 'box', label: '箱子', sprite: 'box', arrayKey: 'boxes', support: true, category: 'prop', hint: '可推动，可垫脚', ...KIND_SIZE.box },
];

/** Look up the editor tool for an element kind (plate/lift/tier2tile expand the rig/terrain tools). */
export function toolForKind(kind: string): ToolDef {
  if (kind === 'plate') return TOOLS.find((t) => t.id === 'rig')!;
  if (kind === 'lift') return { id: 'lift', label: '升降台', sprite: 'lift', support: true, category: 'mechanism', hint: '', ...KIND_SIZE.lift };
  if (kind === 'tier2tile') return { id: 'tier2tile', label: '二层平台板', sprite: 'tile_platform_thin', terrain: true, category: 'terrain', hint: '', w: TILE_W, h: 1.5 };
  return TOOLS.find((t) => t.id === kind) ?? { id: kind, label: kind, category: 'prop', hint: '', w: 1, h: 1 };
}
