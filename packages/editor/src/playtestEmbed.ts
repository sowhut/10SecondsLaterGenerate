/**
 * Playtest sandbox embed (M3). Mounts the hosted Cocos web build in a modal iframe and
 * drives it via the frozen postMessage contract (PLAN §5b, HANDOFF game-side M3 note):
 *
 *   cocos → host   { type: '10s.sandboxReady' }                 (on boot, when embedded)
 *   host  → cocos  { type: '10s.playtest', def, returnScene? }  (after ready)
 *   cocos → host   { type: '10s.playtestResult', won, steps? }
 *
 * Timing: the sandbox boots slowly, so we attach the listener FIRST, wait for
 * `sandboxReady`, THEN post the draft. Message strings come from @10s/schema — never
 * hardcoded. Origin is whitelisted to the configured SANDBOX_URL.
 *
 * Fallback: if `sandboxReady` never arrives (~8s, e.g. a very old build), reload the
 * iframe with `?draft=` boot (URL length permitting).
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

/** True when a sandbox endpoint is configured (VITE_SANDBOX_URL). */
export function isPlaytestConfigured(): boolean {
  return !!CONFIG.SANDBOX_URL;
}

function sandboxOrigin(): string {
  try {
    return new URL(CONFIG.SANDBOX_URL, location.href).origin;
  } catch {
    return '*';
  }
}

function withParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${value}`;
}

const READY_FALLBACK_MS = 8000;
const MAX_URL_DRAFT = 8000;

let active: PlaytestHandle | null = null;

/**
 * Open the playtest sandbox for `def`. Returns a handle; opening again closes the prior
 * session. No-op-safe if SANDBOX_URL is empty (caller should gate on isPlaytestConfigured).
 */
export function openPlaytest(def: LevelDef, cb: PlaytestCallbacks = {}): PlaytestHandle {
  active?.close();

  const origin = sandboxOrigin();
  let sent = false;
  let gotReady = false;
  let done = false;
  let fallbackTimer = 0;

  // ---- overlay DOM ----
  const overlay = document.createElement('div');
  overlay.className = 'playtest-overlay';

  const panel = document.createElement('div');
  panel.className = 'playtest-panel';

  const head = document.createElement('div');
  head.className = 'playtest-head';
  const title = document.createElement('strong');
  title.textContent = `试玩 · ${def.name}`;
  const status = document.createElement('span');
  status.className = 'playtest-status';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'playtest-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '返回编辑 ✕';
  head.append(title, status, closeBtn);

  const frame = document.createElement('iframe');
  frame.className = 'playtest-frame';
  frame.allow = 'autoplay; fullscreen; gamepad';
  frame.title = '10 Seconds Later 试玩沙箱';

  panel.append(head, frame);
  overlay.append(panel);

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function postDraft(): void {
    if (sent || done) return;
    const win = frame.contentWindow;
    if (!win) return;
    win.postMessage({ type: PLAYTEST_IN, def }, origin === '*' ? '*' : origin);
    sent = true;
    setStatus('已注入关卡 · 在沙箱里通关本关');
  }

  function urlBootFallback(): void {
    if (sent || done || gotReady) return;
    const encoded = encodeURIComponent(JSON.stringify(def));
    if (encoded.length > MAX_URL_DRAFT) {
      setStatus('沙箱未回应握手，且关卡过大，无法用 URL 兜底（检查 SANDBOX_URL / 游戏构建）');
      return;
    }
    setStatus('沙箱未回应握手，改用 URL 引导重载…');
    sent = true; // the reloaded frame boots straight into the draft
    frame.src = withParam(CONFIG.SANDBOX_URL, 'draft', encoded);
  }

  function onMessage(ev: MessageEvent): void {
    if (origin !== '*' && ev.origin !== origin) return;
    if (ev.source && ev.source !== frame.contentWindow) return;
    const data = ev.data as { type?: string; won?: boolean; steps?: number } | null;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === SANDBOX_READY) {
      gotReady = true;
      setStatus('沙箱就绪 · 注入关卡…');
      postDraft();
      return;
    }
    if (data.type === PLAYTEST_RESULT) {
      done = true;
      const won = !!data.won;
      setStatus(won ? `✓ 通关！可投稿（M4）${data.steps ? ` · ${data.steps} 步` : ''}` : '未通关 · 可返回编辑再试');
      panel.classList.toggle('won', won);
      cb.onResult?.(won, data.steps);
    }
  }

  function close(): void {
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (active === handle) active = null;
    cb.onClose?.();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') close();
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  // Listener FIRST, then mount the iframe (sandboxReady may fire as soon as it boots).
  window.addEventListener('message', onMessage);
  setStatus('加载沙箱…');
  frame.src = CONFIG.SANDBOX_URL;
  document.body.append(overlay);
  fallbackTimer = window.setTimeout(urlBootFallback, READY_FALLBACK_MS);

  const handle: PlaytestHandle = { close };
  active = handle;
  return handle;
}
