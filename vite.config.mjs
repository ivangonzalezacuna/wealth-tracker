import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  return {
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __BUILD_ID__: JSON.stringify(env.VITE_BUILD_ID || packageJson.version),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) {
              return 'echarts';
            }
            if (id.includes('node_modules/idb-keyval') || id.includes('node_modules/sql.js')) {
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
          globPatterns: ['**/*.{js,mjs,wasm,css,html,svg,png,ico}'],
          navigateFallback: '/index.html',
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      include: ['src/**/*.test.ts'],
      exclude: ['tests/e2e/**'],
    },
  };
});
