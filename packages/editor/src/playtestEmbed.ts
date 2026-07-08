/**
 * Playtest sandbox embed — STUB for M3 (HANDOFF M2 §"不做").
 *
 * M2 only wires up the frozen message constants so M3 can drop in the iframe + postMessage
 * flow without re-deriving the contract. Nothing here touches the DOM yet.
 *
 * M3 will: mount `<iframe src={CONFIG.SANDBOX_URL}>`, post `{ type: PLAYTEST_IN, def }`,
 * and resolve on `{ type: PLAYTEST_RESULT, won, steps }` (optionally gated by SANDBOX_READY).
 */
import {
  PLAYTEST_IN,
  PLAYTEST_RESULT,
  SANDBOX_READY,
  type PlaytestResultMessage,
} from '@10s/schema';

export const PLAYTEST_MESSAGES = {
  in: PLAYTEST_IN,
  result: PLAYTEST_RESULT,
  ready: SANDBOX_READY,
} as const;

export type { PlaytestResultMessage };
