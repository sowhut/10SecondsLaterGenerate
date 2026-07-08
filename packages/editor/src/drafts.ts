/**
 * Local draft store. The PUBLIC editor never writes the game's LevelDef.ts (PLAN §2,
 * HANDOFF M2 §3) — drafts live in memory and persist to localStorage. Export/submit is
 * M4; this only owns new/open/clone/delete + persistence.
 */
import { type LevelDef, THEMES, DOOR_GLOW } from '@10s/schema';

export interface LevelDoc {
  id: string;
  name: string;
  level: LevelDef;
}

const STORAGE_KEY = '10s.editor.drafts.v1';

interface DraftFile {
  version: 1;
  docs: LevelDoc[];
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

/** Read persisted drafts (empty array on first run or any corruption). */
export function loadDocs(): LevelDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DraftFile;
    return Array.isArray(parsed?.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

/** Persist the whole draft set (called on every structural change — autosave). */
export function saveDocs(docs: LevelDoc[]): void {
  try {
    const payload: DraftFile = { version: 1, docs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / unavailable — keep working in memory */
  }
}
