import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
