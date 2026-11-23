// Public addresses from Tailscale Funnel: when this machine runs
// `tailscale funnel <port>`, players anywhere can join at
// https://<machine>.<tailnet>.ts.net/. This reads `tailscale funnel status
// --json` now and then and keeps the URLs whose funnel ends at a given local
// port, so an app can show them next to its LAN addresses. No Tailscale, or no
// funnel, just means no URLs. Built on Node's child_process: no dependencies.
import { execFile } from 'node:child_process';

const REFRESH_MS = 30_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']);

/** A funnel: the public URL and the local port it forwards to. */
interface Funnel {
  url: string;
  port: number;
}

let funnels: Funnel[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/** The public funnel URLs (ending in /) that reach this machine's `port`, as last read. */
export function publicUrls(port: number): string[] {
  start();
  return funnels.filter((f) => f.port === port).map((f) => f.url);
}

/**
 * Calls `listener` whenever the funnels change (one is turned on or off), so a
 * view that shows them can go out again. Returns a function that stops it.
 */
export function onPublicUrlsChange(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Reads the funnels again now. Resolves once they're read (or Tailscale didn't answer). */
export function refreshPublicUrls(): Promise<void> {
  return new Promise((resolve) => {
    execFile('tailscale', ['funnel', 'status', '--json'], { timeout: 5000 }, (err, stdout) => {
      const next = err ? [] : parseFunnelStatus(stdout);
      if (JSON.stringify(next) !== JSON.stringify(funnels)) {
        funnels = next;
        for (const listener of listeners) listener();
      }
      resolve();
    });
  });
}

function start() {
  if (timer) return;
  timer = setInterval(() => void refreshPublicUrls(), REFRESH_MS);
  timer.unref();
  void refreshPublicUrls();
}

/**
 * The funnels in `tailscale funnel status --json`: each `Web` entry open to the
 * internet (`AllowFunnel`) whose handler proxies to a port on this machine.
 * Entries served only inside the tailnet are left out. Exported for the tests.
 */
export function parseFunnelStatus(json: string): Funnel[] {
  let status: { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>; AllowFunnel?: Record<string, boolean> };
  try {
    status = JSON.parse(json);
  } catch {
    return [];
  }
  const found: Funnel[] = [];
  for (const [hostPort, web] of Object.entries(status.Web ?? {})) {
    if (!status.AllowFunnel?.[hostPort]) continue;
    const [host, publicPort] = splitHostPort(hostPort);
    const origin = `https://${host}${publicPort === '443' ? '' : `:${publicPort}`}`;
    for (const [mount, handler] of Object.entries(web.Handlers ?? {})) {
      const port = localPort(handler.Proxy);
      if (port === null) continue;
      found.push({ url: `${origin}${mount.endsWith('/') ? mount : `${mount}/`}`, port });
    }
  }
  return found;
}

function splitHostPort(hostPort: string): [string, string] {
  const i = hostPort.lastIndexOf(':');
  return i < 0 ? [hostPort, '443'] : [hostPort.slice(0, i), hostPort.slice(i + 1)];
}

// The port of a proxy target on this machine ("http://127.0.0.1:8080", or a bare "8080"), or null.
function localPort(proxy: string | undefined): number | null {
  if (!proxy) return null;
  if (/^\d+$/.test(proxy)) return Number(proxy);
  try {
    const url = new URL(proxy);
    if (!LOCAL_HOSTS.has(url.hostname)) return null;
    return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  } catch {
    return null;
  }
}
