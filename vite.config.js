import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Chart.js (~180KB of the bundle) and idb-keyval change far less
        // often than the app's own code. Splitting them into their own
        // chunk means a routine app deploy invalidates only the small
        // app chunk in returning users' browser caches, not this one -
        // and the two chunks can be fetched by the browser in parallel
        // on first load instead of one large sequential download.
        manualChunks: {
          vendor: ['chart.js', 'idb-keyval'],
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
