// Party's dev-server helper for Vite. Typed loosely, so party needs no Vite of
// its own; the app's Vite runs it.
//
//   import { apiProxy } from '../../party/dev/vite.ts';
//   export default defineConfig({ server: { proxy: { '/api': apiProxy(3001) } } });

/**
 * Proxies /api to the party server. When the server stops (`node --watch`
 * restarts it on every change), a plain proxy leaves the browser's side of an
 * event stream open: the device shows "Live" but gets nothing until its
 * watchdog fires. This cuts the browser's side too, so it reconnects at once.
 */
export function apiProxy(serverPort: number) {
  return {
    target: `http://localhost:${serverPort}`,
    configure(proxy: any) {
      proxy.on('proxyRes', (proxyRes: any, _req: unknown, res: any) => {
        proxyRes.on('close', () => {
          if (!proxyRes.complete) res.destroy();
        });
      });
    },
  };
}
