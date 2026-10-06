import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiProxy } from '../../party/dev/vite.ts';

const serverPort = Number(process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: { '/api': apiProxy(serverPort) },
    // The client imports party's client from outside this folder.
    fs: { allow: ['.', '../../party'] },
  },
});
