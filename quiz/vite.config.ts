import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        // When the API server stops (`node --watch` restarts it on every
        // change), the proxy leaves the browser's side of an /api/events
        // stream open. The device then shows "Live" but gets nothing until
        // its 35 s watchdog fires. Cut the browser's side too, so EventSource
        // reconnects at once.
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => {
              if (!proxyRes.complete) res.destroy();
            });
          });
        },
      },
    },
  },
});
