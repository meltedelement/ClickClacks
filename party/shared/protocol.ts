// The wire protocol between a party server (server/index.ts) and its pages
// (client/index.ts). Both sides import it, so they cannot drift apart.
//
//   GET /api/events?token=<player token>   server-sent events: the player's view on every change
//   GET /api/events?key=<admin key>        the same for the admin pages (the admin view)
//   GET /api/lan                           { addresses }: this machine's LAN addresses, private ranges first
//   any other /api route                   the app's own (Party.route), JSON in and out
//
// Each event is `data: <view as JSON>`. A player whose token the app does not
// know gets `data: null` and the stream ends: the device should forget its
// token. Every PING_MS the server sends `event: ping`, so a client that hears
// nothing for SILENCE_MS knows its connection is dead even when the browser
// has not noticed.
//
// Requests that act as someone carry a header: PLAYER_HEADER with the player's
// token, ADMIN_HEADER with the admin key. Errors are { error: message }.

export const PLAYER_HEADER = 'x-player-token';
export const ADMIN_HEADER = 'x-admin-key';

export const EVENTS_PATH = '/api/events';
export const LAN_PATH = '/api/lan';

export const PING_MS = 15_000;
export const SILENCE_MS = 35_000;

/** Who a request or event stream is for. */
export type Credentials = { token: string } | { adminKey: string };

/** Body of every error response. */
export interface ErrorBody {
  error: string;
}

/** GET /api/lan */
export interface LanBody {
  addresses: string[];
}
