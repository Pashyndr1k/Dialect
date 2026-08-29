import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One version, read from the workspace root. The window shows it, and a
// test keeps Cargo and Tauri from drifting away from it.
const { version } = JSON.parse(readFileSync('../../package.json', 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Tauri owns the terminal during `tauri dev`; don't let Vite wipe its output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Model cards and the example IR are read straight out of packages/core,
    // so the dev server has to be allowed above the app root.
    fs: { allow: ['../..'] },
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
