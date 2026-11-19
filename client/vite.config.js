import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// As portas ficam em server/.env (mesmo arquivo usado pelo PM2 e pelo deploy).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../server', '');
  const apiPort = env.API_PORT || '4100';
  const webPort = Number(env.WEB_PORT || 4101);

  return {
    plugins: [react()],
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
    preview: {
      port: webPort,
    },
    build: {
      // PDF.js (~500 kB) só é baixado ao abrir um PDF anexado (import dinâmico)
      chunkSizeWarningLimit: 600,
    },
  };
});
