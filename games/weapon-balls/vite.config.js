import { defineConfig } from 'vite';
import { handleApi } from './server/matches.js';

// `npm run dev` serves the match API (server/matches.js) alongside the game,
// the same way `npm start` does for the built game.
export default defineConfig({
  // flawless.html is the flawless finder page (src/flawless/); the game is index.html.
  build: {
    rolldownOptions: { input: { main: 'index.html', flawless: 'flawless.html' } },
  },
  worker: { format: 'es' },
  plugins: [
    {
      name: 'match-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!(await handleApi(req, res))) next();
        });
      },
    },
  ],
});
