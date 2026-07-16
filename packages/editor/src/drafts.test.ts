import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadDocs, makeDefaultLevel, saveDocs, type LevelDoc } from './drafts.js';

class MemoryStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function doc(): LevelDoc {
  const level = makeDefaultLevel('测试草稿');
  return { id: 'draft-1', name: level.name, level, sourceId: 'L01' };
}

test('valid drafts round-trip through storage', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(saveDocs([doc()], storage), { ok: true });
  assert.deepEqual(loadDocs(storage).docs, [doc()]);
});

test('corrupt drafts are isolated instead of crashing editor startup', () => {
  const storage = new MemoryStorage();
  storage.setItem('10s.editor.drafts.v1', '{bad json');
  const loaded = loadDocs(storage);
  assert.deepEqual(loaded.docs, []);
  assert.match(loaded.warning ?? '', /损坏|旧版本/);
  assert.equal(storage.getItem('10s.editor.drafts.v1'), null);
  assert.equal(storage.getItem('10s.editor.drafts.recovery'), '{bad json');
});

test('save failures are reported to the UI layer', () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const result = saveDocs([doc()], storage);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /quota exceeded/);
});
