# Party

Jackbox-style plumbing for any game where people in a room play on their
phones: players join and act from their phones, an admin runs the game from a
page, and a big screen shows it to the room. Party owns the connections; the
app owns the state, the rules and what each person sees. It knows nothing about
any particular game. The quiz (`apps/quiz-of-doom/`) is built on it.

No dependencies. The server is plain Node (run as TypeScript), the client is
plain browser TypeScript with no framework, so any UI library can wrap it.

```
party/
  server/index.ts    createParty: admin key, player tokens, live views, presence, routes, static client
  client/index.ts    post, eventsUrl, subscribe (event stream with heartbeat watchdog and reconnects)
  shared/protocol.ts the wire protocol: paths, headers, heartbeat timings (both sides import it)
  dev/vite.ts        apiProxy: a Vite dev proxy that doesn't leave dead event streams open
```

## What party does

- **Admin key.** Taken from `ADMIN_KEY`, or made once and kept in
  `<dataDir>/admin-token.txt` so restarts don't lock the admin out. Admin
  pages send it as the `x-admin-key` header (and as `?key=` on the event stream).
- **Players.** The app hands out a token when someone joins (party never makes
  them) and tells party how to find the player behind one. Phones send it as
  the `x-player-token` header (and as `?token=` on the event stream). Tokens
  are secrets: never put one in a view another device sees.
- **Live views.** Each phone and admin page holds a server-sent event stream.
  Party sends each one its view on connect and on every `broadcast()`: the
  app's `playerView(player)` or `adminView({ online })`. A token the app no
  longer knows gets `null` and the stream ends, so the phone forgets it.
- **Bad connections.** A heartbeat goes out every 15 s. The client opens a new
  connection after 35 s of silence, when the page becomes visible again, and
  when the network comes back, with backoff after errors.
- **Presence.** `online` in the admin view is the tokens with a stream open;
  the admin views go out again whenever someone connects or drops.
- **Routes.** JSON routes under `/api`, each `public`, `player` (needs a known
  token) or `admin` (needs the key). Throw a `PartyError` to refuse with a
  message the person sees (400 unless you give a status); anything else is a
  500 and stays in the server log.
- **The rest.** `GET /api/lan` gives this machine's LAN addresses, private ranges
  first (for showing the join address on the big screen). Every path outside
  `/api` serves the built client, with `index.html` for client-side routes.

## Server

```ts
import { PartyError, createParty } from '../party/server/index.ts';

const party = createParty<Player>({
  dataDir: './data',                                  // admin-token.txt goes here
  dist: './dist',                                     // the built client, or null
  findPlayer: (token) => players.get(token),
  playerView: (player) => ({ name: player.name, buzzed }),
  adminView: ({ online }) => ({ players: [...players.values()], online, buzzed }),
});

party.route('POST', '/join', 'public', ({ body }) => {
  if (!body.name) throw new PartyError('Enter a name');
  const token = crypto.randomUUID();
  players.set(token, { name: body.name });
  party.broadcast();
  return { token };                                   // answered as JSON; undefined answers { ok: true }
});
party.route('POST', '/buzz', 'player', ({ player }) => {
  buzzed ??= player!.name;
  party.broadcast();
});
party.route('POST', '/clear', 'admin', () => {
  buzzed = null;
  party.broadcast();
});

party.listen(3001);
```

Call `party.broadcast()` after every change to the state (the quiz does it from
its store's change listener). `party.handle(req, res)` handles one request, for
mounting party in a server of your own; `party.close()` stops it.

`server/party.test.ts` is this buzzer game as a test: `npm test`.

## Client

```ts
import { eventsUrl, post, subscribe } from '../party/client/index.ts';

const { token } = await post('/api/join', { name: 'Ada' });
const stop = subscribe<PlayerView | null>(eventsUrl({ token }), {
  onData: (view) => render(view),                     // null: this player was removed
  onConnected: (live) => showLive(live),
});
await post('/api/buzz', {}, { token });               // as the player
await post('/api/clear', {}, { adminKey });           // as the admin
```

`post` throws an `Error` whose message can be shown as it is. For React, wrap
`subscribe` in a hook; `apps/quiz-of-doom/src/api.ts` is one (`useEvents`).

In development, serve the client with Vite and proxy `/api` to the party server:

```ts
import { apiProxy } from '../party/dev/vite.ts';
export default defineConfig({ server: { proxy: { '/api': apiProxy(3001) }, fs: { allow: ['.', '../party'] } } });
```

`fs.allow` lets Vite serve party's client from outside the app's folder.

## Checks

```sh
npm test            # the server, against a made-up buzzer game
npm run typecheck   # borrows the quiz's TypeScript: npm install in apps/quiz-of-doom first
```

## Not here yet

Things every party game will want and that the quiz still does itself, so they
are the next candidates to move here once a second game needs them: player
colours from a palette with no two the same (`apps/quiz-of-doom/shared/colors.ts`),
rejoining from another device with a short code, the big screen's join address
and fullscreen click, and remembering the token on the phone.
