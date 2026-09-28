import { defineConfig } from 'vite';
import { handleApi } from './server/matches.js';

// `npm run dev` serves the match API (server/matches.js) alongside the game,
// the same way `npm start` does for the built game.
export default defineConfig({
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
