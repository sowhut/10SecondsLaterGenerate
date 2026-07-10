/**
 * Playtest sandbox embed (M3). Mounts the hosted Cocos web build in a modal iframe and
 * drives it via the frozen postMessage contract (PLAN §5b, HANDOFF game-side M3 note):
 *
 *   cocos → host   { type: '10s.sandboxReady' }                 (on boot, when embedded)
 *   host  → cocos  { type: '10s.playtest', def, returnScene? }  (after ready)
 *   cocos → host   { type: '10s.playtestResult', won, steps? }
 *
 * Timing: the sandbox boots slowly (engine + wasm + assets), so we attach the listener
 * FIRST, wait for `sandboxReady`, THEN post the draft — the handshake is what guarantees
 * the exact edited level reaches the engine. Message strings come from @10s/schema.
 * Origin is whitelisted to the configured SANDBOX_URL.
 *
 * If `sandboxReady` never arrives, the overlay enters an explicit recoverable error state.
 * Normal gameplay stays buttonless; retry/return controls appear only after a connection
 * failure. We never inject into an unready sandbox or fall back to wildcard origins.
 */
import { PLAYTEST_IN, PLAYTEST_RESULT, SANDBOX_READY, type LevelDef } from '@10s/schema';
import { CONFIG } from './config';

export interface PlaytestCallbacks {
  onResult?: (won: boolean, steps?: number) => void;
  onClose?: () => void;
}
export interface PlaytestHandle {
  close(): void;
}

export function resolveSandboxUrl(value: string, base: string): URL | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function configuredSandboxUrl(): URL | null {
  return resolveSandboxUrl(CONFIG.SANDBOX_URL, location.href);
}

/** True when a valid HTTP(S) sandbox endpoint is configured (VITE_SANDBOX_URL). */
export function isPlaytestConfigured(): boolean {
  return configuredSandboxUrl() !== null;
}

/** Cold engine boot can be slow; wait generously for the ready handshake. */
const READY_TIMEOUT_MS = 20000;
/** Show a "still loading" reassurance if boot drags on. */
const SLOW_HINT_MS = 6000;
/** How long the result flashes in the header before returning to the editor. */
const RESULT_LINGER_MS = 900;

let active: PlaytestHandle | null = null;

/**
 * Open the playtest sandbox for `def`. Returns a handle; opening again closes the prior
 * session. Caller should gate on isPlaytestConfigured().
 */
export function openPlaytest(def: LevelDef, cb: PlaytestCallbacks = {}): PlaytestHandle {
  active?.close();

  const sandboxUrl = configuredSandboxUrl();
  if (!sandboxUrl) throw new Error('VITE_SANDBOX_URL must be a valid HTTP(S) URL');
  const origin = sandboxUrl.origin;
  const sandboxHref = sandboxUrl.href;
  let sent = false;
  let gotReady = false;
  let done = false;
  const loadingTimers: number[] = [];
  const resultTimers: number[] = [];

  // ---- overlay DOM (no clickable buttons — keyboard only) ----
  const overlay = document.createElement('div');
  overlay.className = 'playtest-overlay';

  const panel = document.createElement('div');
  panel.className = 'playtest-panel';
  panel.tabIndex = -1; // focusable so Esc reaches the parent after a result

  const head = document.createElement('div');
  head.className = 'playtest-head';
  const title = document.createElement('strong');
  title.textContent = `试玩 · ${def.name}`;
  const status = document.createElement('span');
  status.className = 'playtest-status';
  const hint = document.createElement('span');
  hint.className = 'playtest-hint-inline';
  hint.textContent = '按 Esc 返回编辑';

  const errorActions = document.createElement('span');
  errorActions.className = 'playtest-error-actions';
  errorActions.hidden = true;
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = '重试';
  const returnButton = document.createElement('button');
  returnButton.type = 'button';
  returnButton.textContent = '返回编辑';
  errorActions.append(retryButton, returnButton);
  head.append(title, status, hint, errorActions);

  const frame = document.createElement('iframe');
  frame.className = 'playtest-frame';
  frame.allow = 'autoplay; fullscreen; gamepad';
  frame.title = '10 Seconds Later 试玩沙箱';

  panel.append(head, frame);
  overlay.append(panel);

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function summarize(d: LevelDef): string {
    const len = (a: unknown): number => (Array.isArray(a) ? a.length : 0);
    const objs = 3 + (d.bomb ? 1 : 0) + len(d.boxes) + len(d.spikes) + len(d.walls) + len(d.stones) + len(d.rigs) * 2;
    return `「${d.name}」· ${len(d.rigs)}机关 · ${objs}物件 · ${d.clones}分身`;
  }

  function postDraft(): void {
    if (sent || done) return;
    const win = frame.contentWindow;
    if (!win) return;
    // Diagnostic: what we send. If the sandbox shows something else, the served build
    // lacks playtest support (needs a fresh web-mobile build).
    console.info('[10s editor] playtest → injecting draft:', def.name, def);
    win.postMessage({ type: PLAYTEST_IN, def }, origin);
    sent = true;
    setStatus(`已注入 ${summarize(def)} · 沙箱内应显示此关`);
  }

  function onMessage(ev: MessageEvent): void {
    if (ev.origin !== origin) return;
    if (ev.source !== frame.contentWindow) return;
    const data = ev.data as { type?: string; won?: boolean; steps?: number } | null;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === SANDBOX_READY) {
      gotReady = true;
      errorActions.hidden = true;
      clearLoadingTimers();
      setStatus('沙箱就绪 · 注入关卡…');
      postDraft();
      return;
    }
    if (data.type === PLAYTEST_RESULT) {
      done = true;
      clearLoadingTimers();
      const won = !!data.won;
      panel.classList.toggle('won', won);
      setStatus(won ? `✓ 通关！可投稿（M4）${data.steps ? ` · ${data.steps} 步` : ''}` : '未通关 · 返回编辑');
      cb.onResult?.(won, data.steps);
      // Auto-return to the editor (there is no close button; result IS the keyboard/
      // gameplay-driven exit). Esc still works while the parent has focus.
      resultTimers.push(window.setTimeout(close, RESULT_LINGER_MS));
    }
  }

  function clearLoadingTimers(): void {
    while (loadingTimers.length) window.clearTimeout(loadingTimers.pop());
  }

  function armLoadingTimers(): void {
    loadingTimers.push(
      window.setTimeout(() => {
        if (!gotReady && !done) setStatus('加载沙箱…（首次加载引擎/资源较慢，请稍候）');
      }, SLOW_HINT_MS),
    );
    loadingTimers.push(
      window.setTimeout(() => {
        if (gotReady || sent || done) return;
        setStatus('无法连接试玩沙箱，请确认服务可访问后重试');
        errorActions.hidden = false;
      }, READY_TIMEOUT_MS),
    );
  }

  function retry(): void {
    clearLoadingTimers();
    sent = false;
    gotReady = false;
    done = false;
    errorActions.hidden = true;
    setStatus('重新加载沙箱…');
    frame.src = sandboxHref;
    armLoadingTimers();
  }

  function close(): void {
    clearLoadingTimers();
    for (const t of resultTimers) window.clearTimeout(t);
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (active === handle) active = null;
    cb.onClose?.();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') close();
  }

  document.addEventListener('keydown', onKey);
  retryButton.addEventListener('click', retry);
  returnButton.addEventListener('click', close);

  // Listener FIRST, then mount the iframe (sandboxReady may fire as soon as it boots).
  window.addEventListener('message', onMessage);
  setStatus('加载沙箱…');
  frame.src = sandboxHref;
  document.body.append(overlay);
  panel.focus();

  armLoadingTimers();

  const handle: PlaytestHandle = { close };
  active = handle;
  return handle;
}
