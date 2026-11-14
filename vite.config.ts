/** Builds the browser UI into `dist/ui`; `vite.server.config.ts` then embeds it into the server bundle. */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  // The highlighting worker loads grammars with dynamic imports, which needs an ES module worker.
  worker: { format: 'es' },
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
});
