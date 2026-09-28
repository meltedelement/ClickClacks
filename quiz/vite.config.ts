import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: { '/api': `http://localhost:${serverPort}` },
  },
});
