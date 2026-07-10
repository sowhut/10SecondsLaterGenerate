/**
 * Runtime configuration, all injectable via Vite `import.meta.env` (PLAN §7).
 *
 * No art or sandbox build lives in this repo — they are fetched at runtime from
 * configurable hosted endpoints. For local dev, point VITE_SPRITE_BASE_URL at a
 * running art endpoint (e.g. the private generator's `/sprites`, or a deployed CDN).
 */
const ENV = import.meta.env ?? {};

export const CONFIG = {
  /** Hosted sprite endpoint. Images load from `${SPRITE_BASE_URL}/<name>.png`. */
  SPRITE_BASE_URL: ENV.VITE_SPRITE_BASE_URL ?? '/sprites',
  /** Hosted Cocos web build for the M3 playtest sandbox iframe (empty = not wired). */
  SANDBOX_URL: ENV.VITE_SANDBOX_URL ?? '',
  /** Private backend base for M4 submit (empty = local-only, no submission). */
  API_BASE_URL: ENV.VITE_API_BASE_URL ?? '',
} as const;
