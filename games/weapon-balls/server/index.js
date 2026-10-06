// Serves the built game (dist/) and the match API (matches.js) on one port.
// No dependencies: `npm run build && npm start`. During development
// `npm run dev` serves the same API from the Vite dev server instead.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleApi } from './matches.js';

const PORT = Number(process.env.PORT ?? 3002);
const DIST = path.join(import.meta.dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(DIST, path.normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('Game not built. Run `npm run build`, or use `npm run dev`.');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    if (!(await handleApi(req, res))) serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Weapon Balls on http://localhost:${PORT}`);
    console.log(`  Display page: http://localhost:${PORT}/?display`);
    console.log(`  Match API:    http://localhost:${PORT}/api/matches`);
  });
