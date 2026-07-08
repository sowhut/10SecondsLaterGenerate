/**
 * Playtest sandbox contract (PLAN §5b) — the wire protocol between the editor (host
 * page) and the embedded real Cocos web build (playtest sandbox).
 *
 * FROZEN. These message-type strings ARE the connection to the game's
 * `assets/scripts/editor/PlaytestBridge.ts`. Change one character and the link breaks.
 * Both the editor and the game must import these consts — never hardcode the strings.
 */

import type { LevelDef } from './levelDef';

/** host(editor) → cocos: hand a draft LevelDef into the sandbox to play. */
export const PLAYTEST_IN = '10s.playtest';
/** cocos → host(editor): report the playtest outcome. */
export const PLAYTEST_RESULT = '10s.playtestResult';
/**
 * cocos → host(editor): sandbox is booted and listening (PLAN §5b-B / §10.1 handshake).
 * The game does not emit this yet; it will be added in the game repo when M3 needs it,
 * so the editor can wait for readiness before posting a draft.
 */
export const SANDBOX_READY = '10s.sandboxReady';

/** host → cocos */
export interface PlaytestRequest {
  type: typeof PLAYTEST_IN;
  def: LevelDef;
  returnScene?: string;
}

/** cocos → host. `won === true` = author beat their own draft (unlocks export/submit). */
export interface PlaytestResultMessage {
  type: typeof PLAYTEST_RESULT;
  won: boolean;
  steps?: number; // sim steps to win (60 = 1 s)
}

/** cocos → host (future handshake). */
export interface SandboxReadyMessage {
  type: typeof SANDBOX_READY;
}

export type PlaytestMessage = PlaytestRequest | PlaytestResultMessage | SandboxReadyMessage;
