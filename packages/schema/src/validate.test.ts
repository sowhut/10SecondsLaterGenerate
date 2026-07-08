import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateLevel, isPlayable, isLevelDefShape, type LevelDef } from './index';

/** A minimal, known-good level (LEVEL1's shape) that must validate clean. */
function mkValid(): LevelDef {
  return {
    name: '初次同行',
    recordSteps: 600,
    floorRows: 3,
    tier2Tiles: [{ col: 27 }, { col: 30 }, { col: 33 }, { col: 36 }, { col: 39 }, { col: 42 }],
    rigs: [
      { plate: { col: 7.5, w: 2, tier: 1 }, lift: { col: 23.5, w: 3, restTier: 1, topTier: 2 }, color: '#46E5F2' },
    ],
    key: { col: 30.5, tier: 2, w: 1, h: 2 },
    door: { col: 39.5, tier: 2, w: 2, h: 3 },
    clones: 1,
    spawn: { col: 19, tier: 1 },
  };
}

const clone = (x: LevelDef): LevelDef => JSON.parse(JSON.stringify(x)) as LevelDef;

test('a well-formed level validates clean', () => {
  assert.deepEqual(validateLevel(mkValid()), []);
  assert.equal(isPlayable(mkValid()), true);
});

test('a floating key (over empty tier-2) is flagged', () => {
  const def = clone(mkValid());
  def.key = { col: 1, tier: 2, w: 1, h: 2 }; // no tier-2 tile near col 1
  const issues = validateLevel(def);
  assert.ok(
    issues.some((i) => i.ref === 'key' && i.code === 'floating'),
    `expected a floating key, got ${JSON.stringify(issues)}`,
  );
  assert.equal(isPlayable(def), false);
});

test('a missing door is flagged as an existence error', () => {
  const def = clone(mkValid());
  delete (def as Partial<LevelDef>).door;
  const issues = validateLevel(def);
  assert.ok(
    issues.some((i) => i.ref === 'door' && i.code === 'missing'),
    `expected a missing door, got ${JSON.stringify(issues)}`,
  );
});

test('more than MAX_RIGS (3) rigs is flagged', () => {
  const def = clone(mkValid());
  const rig = def.rigs[0];
  def.rigs = Array.from({ length: 4 }, () => JSON.parse(JSON.stringify(rig)) as typeof rig);
  const issues = validateLevel(def);
  assert.ok(
    issues.some((i) => i.code === 'rig-limit'),
    `expected a rig-limit issue, got ${JSON.stringify(issues)}`,
  );
});

test('isLevelDefShape guards malformed drafts', () => {
  assert.equal(isLevelDefShape(mkValid()), true);
  assert.equal(isLevelDefShape({}), false);
  assert.equal(isLevelDefShape(null), false);
});
