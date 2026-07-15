/**
 * Official-level validation and production publishing.
 *
 * The tool lives on main with the public schema/editor. Plain official JSON and
 * playtest approvals live only on the protected `levels` branch under
 * levels/official and levels/playtest-approvals.json.
 */

import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateLevel } from '../packages/schema/dist/validate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = process.env.LEVELS_CONTENT_DIR
  ? resolve(process.env.LEVELS_CONTENT_DIR)
  : resolve(ROOT, 'levels');
const OFFICIAL_DIR = resolve(CONTENT_DIR, 'official');
const APPROVALS_FILE = resolve(CONTENT_DIR, 'playtest-approvals.json');
const RELEASE_DIR = resolve(ROOT, 'dist/levels');
const SCHEMA_FILE = resolve(ROOT, 'packages/schema/level.schema.json');
const SCHEMA_VERSION = 1;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function officialLevels() {
  if (!existsSync(OFFICIAL_DIR)) {
    throw new Error(
      'Official levels are absent on this branch. Check out the protected `levels` branch first.',
    );
  }
  const files = readdirSync(OFFICIAL_DIR)
    .filter((name) => /^L\d{2}\.json$/.test(name))
    .sort();
  if (!files.length) throw new Error(`No official levels found in ${OFFICIAL_DIR}`);

  return files.map((file, index) => {
    const ordinal = Number(file.slice(1, 3));
    if (ordinal !== index + 1) {
      throw new Error(`Official levels must be contiguous from L01; got ${file} at slot ${index + 1}`);
    }
    const def = readJson(resolve(OFFICIAL_DIR, file));
    const canonical = canonicalJson(def);
    return {
      id: `L${ordinal}`,
      sourceId: `L${String(ordinal).padStart(2, '0')}`,
      ordinal,
      def,
      hash: sha256(canonical),
    };
  });
}

function schemaValidator() {
  return new Ajv({ allErrors: true, strict: false }).compile(readJson(SCHEMA_FILE));
}

function validateAll(levels = officialLevels()) {
  const validateShape = schemaValidator();
  const names = new Set();
  const failures = [];

  for (const level of levels) {
    if (!validateShape(level.def)) {
      const detail = (validateShape.errors ?? [])
        .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
        .join('; ');
      failures.push(`${level.sourceId} schema: ${detail}`);
      continue;
    }

    for (const issue of validateLevel(level.def)) {
      failures.push(`${level.sourceId} ${issue.code} ${issue.ref}: ${issue.reason}`);
    }
    if (names.has(level.def.name)) failures.push(`${level.sourceId}: duplicate name ${level.def.name}`);
    names.add(level.def.name);
    const engine = level.def.minEngineVersion ?? 1;
    if (!Number.isInteger(engine) || engine < 1) {
      failures.push(`${level.sourceId}: minEngineVersion must be a positive integer`);
    }
    if (level.def.comingSoon) failures.push(`${level.sourceId}: production levels cannot be comingSoon`);
  }

  if (failures.length) throw new Error(`Official level validation failed:\n- ${failures.join('\n- ')}`);
  console.log(`[levels] structure + semantics passed for ${levels.length} official levels`);
  return levels;
}

function approvals() {
  return existsSync(APPROVALS_FILE) ? readJson(APPROVALS_FILE) : { version: 1, levels: {} };
}

function requireApprovals(levels) {
  const ledger = approvals();
  const stale = levels.filter((level) => ledger.levels?.[level.sourceId]?.sha256 !== level.hash);
  if (stale.length) {
    throw new Error(
      `Real-engine playtest approval missing/stale for: ${stale.map((level) => level.sourceId).join(', ')}. ` +
      'Beat each changed level in Cocos, then run `pnpm levels:approve -- Lxx`.',
    );
  }
}

function approve(id) {
  if (!/^L\d{2}$/.test(id ?? '')) throw new Error('Usage: pnpm levels:approve -- L01');
  const level = validateAll().find((item) => item.sourceId === id);
  if (!level) throw new Error(`Unknown official level ${id}`);
  const ledger = approvals();
  ledger.version = 1;
  ledger.levels ??= {};
  ledger.levels[id] = {
    sha256: level.hash,
    approvedAt: new Date().toISOString(),
    note: 'Confirmed beatable in the real Cocos runtime',
  };
  writeFileSync(APPROVALS_FILE, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  console.log(`[levels] approved ${id} ${level.hash.slice(0, 8)}`);
}

function adopt(fileArg, idArg) {
  if (!fileArg) throw new Error('Usage: pnpm levels:adopt -- /path/to/export.json [L08]');
  mkdirSync(OFFICIAL_DIR, { recursive: true });
  const input = readJson(resolve(fileArg));
  const def = input && typeof input === 'object' && 'def' in input ? input.def : input;
  const existing = readdirSync(OFFICIAL_DIR).filter((name) => /^L\d{2}\.json$/.test(name)).sort();
  const id = idArg ?? `L${String(existing.length + 1).padStart(2, '0')}`;
  if (!/^L\d{2}$/.test(id)) throw new Error(`Invalid level id ${id}; expected L01`);
  const target = resolve(OFFICIAL_DIR, `${id}.json`);
  if (existsSync(target)) throw new Error(`${id} already exists; edit it explicitly instead of overwriting via adopt`);

  writeFileSync(target, `${JSON.stringify(def, null, 2)}\n`, 'utf8');
  try {
    validateAll();
  } catch (error) {
    unlinkSync(target);
    throw error;
  }
  console.log(`[levels] adopted ${id} from ${resolve(fileArg)}; Cocos playtest approval is now required`);
}

function release(levels = validateAll()) {
  requireApprovals(levels);
  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(RELEASE_DIR, { recursive: true });

  const manifestLevels = levels.map((level) => {
    const file = `${level.sourceId}.v${level.hash.slice(0, 8)}.json`;
    const minEngineVersion = level.def.minEngineVersion ?? 1;
    const body = { schemaVersion: SCHEMA_VERSION, minEngineVersion, def: level.def };
    writeFileSync(resolve(RELEASE_DIR, file), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    return {
      id: level.id,
      ordinal: level.ordinal,
      name: level.def.name,
      file,
      sha256: level.hash,
      minEngineVersion,
      comingSoon: false,
    };
  });

  const releaseId = sha256(
    JSON.stringify(manifestLevels.map(({ id, file, sha256: hash }) => ({ id, file, sha256: hash }))),
  ).slice(0, 12);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    releaseId,
    generatedAt: new Date().toISOString(),
    levels: manifestLevels,
  };
  writeFileSync(resolve(RELEASE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[levels] production release ${releaseId} -> ${RELEASE_DIR}`);
  manifestLevels.forEach((item) => console.log(`  ${item.id.padEnd(3)} ${item.file} ${item.name}`));
}

const command = process.argv[2] ?? 'validate';
if (command === 'validate') validateAll();
else if (command === 'approve') approve(process.argv[3]);
else if (command === 'adopt') adopt(process.argv[3], process.argv[4]);
else if (command === 'release') release();
else throw new Error(`Unknown command: ${command}`);
