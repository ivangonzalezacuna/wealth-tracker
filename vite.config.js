import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/chart.js') ||
            id.includes('node_modules/idb-keyval') ||
            id.includes('node_modules/sql.js')
          ) {
            return 'vendor';
          }
        },
      },
    },
  },
  resolve: {
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/manifest.json already exists
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
