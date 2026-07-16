/**
 * Import/export boundary for untrusted browser JSON files.
 *
 * The editor accepts either a bare LevelDef or the public LevelEnvelope used by
 * submissions and production bodies. Parsing is defensive; exporting always emits
 * the canonical envelope shape so downstream maintainer tooling has one format.
 */

import {
  DEFAULT_MIN_ENGINE_VERSION,
  SCHEMA_VERSION,
  isLevelDefShape,
  validateLevel,
  type LevelDef,
  type LevelEnvelope,
  type ValidationIssue,
} from '@10s/schema';

export interface ImportedLevel {
  level: LevelDef;
  sourceId?: string;
  issues: ValidationIssue[];
}

/** Generous ceiling for a level that is normally only a few kilobytes. */
export const MAX_LEVEL_JSON_BYTES = 1_000_000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Recover an official source id from L01.json or an immutable L01.vdeadbeef.json body. */
export function sourceIdFromFilename(filename: string): string | undefined {
  return /^(L\d{2})(?:\.v[0-9a-f]{8})?\.json$/i.exec(filename)?.[1]?.toUpperCase();
}

/** Parse an untrusted JSON string into a detached editor draft. */
export function parseLevelJson(raw: string, filename = ''): ImportedLevel {
  if (new TextEncoder().encode(raw).byteLength > MAX_LEVEL_JSON_BYTES) {
    throw new Error('关卡 JSON 超过 1 MB 限制');
  }
  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }

  let def: unknown = input;
  let envelopeMinEngineVersion: number | undefined;
  if (isRecord(input) && 'def' in input) {
    if (input.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`不支持的 schemaVersion：${String(input.schemaVersion)}（当前为 ${SCHEMA_VERSION}）`);
    }
    if (!isPositiveInteger(input.minEngineVersion)) {
      throw new Error('LevelEnvelope.minEngineVersion 必须是正整数');
    }
    envelopeMinEngineVersion = input.minEngineVersion;
    def = input.def;
  }

  if (!isLevelDefShape(def)) {
    throw new Error('文件不符合 LevelDef / LevelEnvelope 格式');
  }

  const level = clone(def);
  const defMinEngineVersion = level.minEngineVersion ?? DEFAULT_MIN_ENGINE_VERSION;
  if (!isPositiveInteger(defMinEngineVersion)) {
    throw new Error('LevelDef.minEngineVersion 必须是正整数');
  }
  if (envelopeMinEngineVersion !== undefined && envelopeMinEngineVersion !== defMinEngineVersion) {
    throw new Error('LevelEnvelope 与 LevelDef 的 minEngineVersion 不一致');
  }

  return {
    level,
    sourceId: sourceIdFromFilename(filename),
    issues: validateLevel(level),
  };
}

/** Create a detached production-compatible envelope from the current draft. */
export function createLevelEnvelope(def: LevelDef): LevelEnvelope {
  const level = clone(def);
  const minEngineVersion = level.minEngineVersion ?? DEFAULT_MIN_ENGINE_VERSION;
  if (!isPositiveInteger(minEngineVersion)) {
    throw new Error('LevelDef.minEngineVersion 必须是正整数');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    minEngineVersion,
    def: level,
  };
}

export function serializeLevelEnvelope(def: LevelDef): string {
  return `${JSON.stringify(createLevelEnvelope(def), null, 2)}\n`;
}

export function exportFilename(sourceId: string | undefined, levelName: string): string {
  if (/^L\d{2}$/.test(sourceId ?? '')) return `${sourceId}.json`;
  const safeName = levelName.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return `level-${safeName || 'draft'}.json`;
}
