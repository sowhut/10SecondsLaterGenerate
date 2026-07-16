import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeDefaultLevel } from './drafts.js';
import {
  createLevelEnvelope,
  exportFilename,
  MAX_LEVEL_JSON_BYTES,
  parseLevelJson,
  sourceIdFromFilename,
} from './levelFiles.js';

test('imports a bare LevelDef and retains an official source id from its filename', () => {
  const level = makeDefaultLevel('导入关卡');
  const imported = parseLevelJson(JSON.stringify(level), 'L01.json');
  assert.deepEqual(imported.level, level);
  assert.equal(imported.sourceId, 'L01');
  assert.deepEqual(imported.issues, []);
});

test('imports a production envelope and immutable body filename', () => {
  const level = { ...makeDefaultLevel('二代引擎关卡'), minEngineVersion: 2 };
  const imported = parseLevelJson(
    JSON.stringify({ schemaVersion: 1, minEngineVersion: 2, def: level }),
    'L08.vdeadbeef.json',
  );
  assert.deepEqual(imported.level, level);
  assert.equal(imported.sourceId, 'L08');
});

test('rejects malformed, future-schema, and version-mismatched envelopes', () => {
  assert.throws(() => parseLevelJson('{bad json'), /JSON 解析失败/);
  assert.throws(
    () => parseLevelJson(JSON.stringify({ schemaVersion: 2, minEngineVersion: 1, def: makeDefaultLevel() })),
    /schemaVersion/,
  );
  assert.throws(
    () => parseLevelJson(JSON.stringify({ schemaVersion: 1, minEngineVersion: 2, def: makeDefaultLevel() })),
    /minEngineVersion 不一致/,
  );
  assert.throws(() => parseLevelJson(JSON.stringify({ name: 'not a level' })), /不符合/);
  assert.throws(() => parseLevelJson(' '.repeat(MAX_LEVEL_JSON_BYTES + 1)), /1 MB/);
});

test('exports a detached production-compatible envelope', () => {
  const level = makeDefaultLevel('导出关卡');
  const envelope = createLevelEnvelope(level);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.minEngineVersion, 1);
  assert.deepEqual(envelope.def, level);
  envelope.def.name = 'mutated export';
  assert.equal(level.name, '导出关卡');
});

test('normalises official ids and safe download filenames', () => {
  assert.equal(sourceIdFromFilename('l09.VABCDEF12.json'), 'L09');
  assert.equal(sourceIdFromFilename('draft.json'), undefined);
  assert.equal(exportFilename('L01', 'ignored'), 'L01.json');
  assert.equal(exportFilename(undefined, '我的 / 新关卡'), 'level-我的-新关卡.json');
});
