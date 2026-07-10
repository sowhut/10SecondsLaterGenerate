/**
 * @10s/schema — the public level-format contract for 10 Seconds Later.
 *
 *   levelDef  — LevelDef + all sub-interfaces, LevelEnvelope, SCHEMA_VERSION, MAX_RIGS
 *   grid      — grid constants (COLS/ROWS/CELL/ORIGIN…) + snapHalf/clamp
 *   playtest  — frozen playtest sandbox message contract
 *   validate  — support/existence/overlap/bounds validation (ported from the generator)
 */
export * from './levelDef.js';
export * from './grid.js';
export * from './playtest.js';
export * from './validate.js';
