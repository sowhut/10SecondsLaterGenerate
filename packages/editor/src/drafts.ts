/**
 * Local draft store. The PUBLIC editor never writes the game's LevelDef.ts (PLAN §2,
 * HANDOFF M2 §3) — drafts live in memory and persist to localStorage. Export/submit is
 * M4; this only owns new/open/clone/delete + persistence.
 */
import { type LevelDef, THEMES, DOOR_GLOW, isLevelDefShape } from '@10s/schema';

export interface LevelDoc {
  id: string;
  name: string;
  level: LevelDef;
  /** Official id inferred from an imported Lxx JSON; clones/new drafts intentionally omit it. */
  sourceId?: string;
}

const STORAGE_KEY = '10s.editor.drafts.v1';
const RECOVERY_KEY = '10s.editor.drafts.recovery';

interface DraftFile {
  version: 1;
  docs: LevelDoc[];
}

export interface DraftLoadResult {
  docs: LevelDoc[];
  warning?: string;
}

export interface DraftSaveResult {
  ok: boolean;
  error?: string;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isLevelDoc(value: unknown): value is LevelDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<LevelDoc>;
  return (
    typeof doc.id === 'string' &&
    typeof doc.name === 'string' &&
    (doc.sourceId === undefined || /^L\d{2}$/.test(doc.sourceId)) &&
    isLevelDefShape(doc.level)
  );
}

function recoverCorruptDrafts(storage: DraftStorage, raw: string): DraftLoadResult {
  let backedUp = false;
  try {
    storage.setItem(RECOVERY_KEY, raw);
    backedUp = true;
  } catch {
    // Keep the original key intact when a recovery copy cannot be written.
  }
  if (backedUp) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // The recovery copy is safe even if the original key cannot be removed.
    }
  }
  return {
    docs: [],
    warning: backedUp ? '检测到损坏或旧版本草稿，已隔离并新建空白草稿' : '检测到损坏或旧版本草稿，但无法写入恢复副本',
  };
}

/** A blank, immediately-valid level (implicit full ground floor, no rigs yet). */
export function makeDefaultLevel(name = '新关卡'): LevelDef {
  return {
    name,
    recordSteps: 600,
    floorRows: 3,
    theme: { ...THEMES.indigo },
    rigs: [],
    key: { col: 30, tier: 1, w: 1, h: 2 },
    door: { col: 40, tier: 1, w: 2, h: 3, glow: [DOOR_GLOW[0], DOOR_GLOW[1]] },
    clones: 1,
    spawn: { col: 20, tier: 1 },
  };
}

export function newDocId(): string {
  return crypto.randomUUID();
}

/** Read and validate persisted drafts. Corrupt payloads are isolated for recovery. */
export function loadDocs(storage: DraftStorage = localStorage): DraftLoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { docs: [], warning: `无法读取本地草稿：${message}` };
  }
  if (!raw) return { docs: [] };

  try {
    const parsed = JSON.parse(raw) as DraftFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.docs) || !parsed.docs.every(isLevelDoc)) {
      return recoverCorruptDrafts(storage, raw);
    }
    return { docs: parsed.docs };
  } catch {
    return recoverCorruptDrafts(storage, raw);
  }
}

/** Persist the whole draft set and report failures instead of claiming a false autosave. */
export function saveDocs(docs: LevelDoc[], storage: DraftStorage = localStorage): DraftSaveResult {
  try {
    const payload: DraftFile = { version: 1, docs };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { ok: false, error: `本地保存失败：${message}` };
  }
}
