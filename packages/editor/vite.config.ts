import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Static multi-page site. Env vars are injected via VITE_* (see src/config.ts):
//   VITE_SPRITE_BASE_URL  hosted art endpoint (no PNGs live in this repo)
//   VITE_SANDBOX_URL      hosted Cocos web build used as the playtest sandbox
//   VITE_API_BASE_URL     private submission backend (empty = local-only)
export default defineConfig({
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 5180 },
  build: {
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor/index.html', import.meta.url)),
      },
    },
  },
});
