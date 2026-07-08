import { defineConfig } from 'vite';

// Static SPA. Env vars are injected via VITE_* (see src/config.ts / PLAN §7):
//   VITE_SPRITE_BASE_URL  hosted art endpoint (no PNGs live in this repo)
//   VITE_SANDBOX_URL      hosted Cocos web build (M3 playtest sandbox)
//   VITE_API_BASE_URL     private backend (M4 submit; empty = local-only)
export default defineConfig({
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 5180 },
});
