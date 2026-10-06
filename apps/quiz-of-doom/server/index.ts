// The quiz server: party (party/ in the repo root) runs the connections, the
// admin key and the built client; this file adds the quiz's routes and its
// link to the tournament service. No dependencies: run with `node server/index.ts`.
import path from 'node:path';
import { createParty, lanAddresses } from '../../../party/server/index.ts';
import * as store from './store.ts';
import * as catalog from './catalog.ts';
import * as tournament from './tournament.ts';
import { currentStage } from '../shared/tournament.ts';
import type { FormatId, Team } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 3001);

const party = createParty<Team>({
  dataDir: path.join(import.meta.dirname, '..', 'data'),
  dist: path.join(import.meta.dirname, '..', 'dist'),
  findPlayer: (token) => store.findTeam(token),
  playerView: (team) => store.teamView(team),
  adminView: ({ online }) => store.adminView(online),
});

store.onChange(party.broadcast);
// The tournament holds each team's name, colour and loadout: keep them in step.
store.onChange(() => void syncEntrants().catch(() => {}));

// Every team's loadout, as an export the admin page links to: one { team, color, weapon, upgrades, transformations } per team.
party.route('GET', '/loadouts', 'public', () => store.loadouts());
party.route('GET', '/weapons', 'public', () => store.getCatalog().weapons);
// The join form asks for this every few seconds, so it can grey out the colours other teams took.
party.route('GET', '/colors', 'public', () => ({ taken: store.takenColors() }));

party.route('POST', '/join', 'public', ({ body }) => ({ token: store.join(body.name, body.weapon, body.color, body.code).id }));
party.route('POST', '/admin', 'admin', async ({ body }) => {
  await adminAction(body);
});

party.route('POST', '/answer', 'player', ({ player, body }) => store.answer(player!, body.choice));
party.route('POST', '/weapon', 'player', ({ player, body }) => store.chooseWeapon(player!, body.weapon));
party.route('POST', '/color', 'player', ({ player, body }) => store.chooseColor(player!, body.color));
party.route('POST', '/pick', 'player', ({ player, body }) => store.pick(player!, body.upgradeId, body.picksUsed));
party.route('POST', '/transform', 'player', ({ player, body }) => store.pickTransformation(player!, String(body.transformationId), body.count));

// Battle actions go to the tournament service, so they are handled here rather
// than in store.adminAction. Everything else goes to the store.
async function adminAction(body: any) {
  try {
    switch (body?.type) {
      case 'battleCreate':
        return await createBattle(body.format, body.seed === undefined || body.seed === '' || body.seed === null ? undefined : Number(body.seed));
      case 'battleStartRound':
        return await startStage();
      case 'battleStopRound':
        return await tournament.stop(battleId());
      case 'battleReplay':
        return await tournament.replay(battleId(), String(body.matchId));
      case 'battleSetWinner':
        return await tournament.setWinner(battleId(), String(body.matchId), String(body.winner));
      case 'battleReset':
        return await resetBattle();
      case 'refreshCatalog':
        return await refreshCatalog();
    }
    // A quiz reset also drops the battle: take its matches off the game first.
    if (body?.type === 'reset') await resetBattle();
    store.adminAction(body);
    // Moving the quiz into the battle draws the bracket, so the presenter's Next
    // button is all the host needs: the next press starts the first stage. A
    // loadout the game would refuse comes back as a 400 with the reason, which
    // both the admin and the presenter pages show.
    if (body?.type === 'setPhase' && body.phase === 'battle' && !store.state.tournamentId && store.state.teams.length >= 2) {
      await createBattle();
    }
  } catch (err) {
    // The tournament service's refusals (a bad loadout, a stage already started) go to the host as they are.
    if (err instanceof tournament.TournamentApiError) throw new store.UserError(err.message);
    throw err;
  }
}

function battleId(): string {
  if (!store.state.tournamentId) throw new store.UserError('Draw the bracket first.');
  return store.state.tournamentId;
}

// The teams as entrants: their public entrant ids, never the device tokens.
function entrants() {
  return store.state.teams.map((team) => ({ ...team, id: team.entrantId }));
}

function syncEntrants() {
  return tournament.sync(entrants());
}

async function createBattle(format: FormatId = 'double-elimination', seed?: number) {
  if (store.state.tournamentId) throw new store.UserError('There is already a bracket. Reset the battle first.');
  if (store.state.teams.length < 2) throw new store.UserError('A battle needs at least two teams.');
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32)) {
    throw new store.UserError('The seed must be a whole number from 0 to 4294967295.');
  }
  const t = await tournament.create(format, entrants().map(tournament.toEntrant), seed);
  store.setTournament(t.id);
}

// Sends the teams' loadouts as they are now, then starts the stage.
async function startStage() {
  const t = store.battle();
  const stage = t && currentStage(t);
  if (!t || !stage) throw new store.UserError('Draw the bracket first.');
  const ids = new Set(stage.groups.flatMap((g) => g.entrants));
  if (store.state.teams.filter((team) => ids.has(team.entrantId)).length < ids.size) {
    throw new store.UserError('A team in this stage was deleted. Reset the battle.');
  }
  await syncEntrants();
  await tournament.start(t.id);
}

async function resetBattle() {
  const id = store.state.tournamentId;
  if (!id) return;
  try {
    await tournament.remove(id);
  } catch (err) {
    // The service is down: forget the battle here anyway, so the host is not stuck.
    if (!(err instanceof tournament.TournamentApiError && err.status === 0)) throw err;
  }
  store.setTournament(null);
}

// The catalog comes from the game (through the tournament service), so the
// quiz always offers upgrades by their real ids and stack limits.
async function refreshCatalog() {
  const live = await catalog.refresh(`${tournament.TOURNAMENT_API}/host`);
  store.onCatalogChanged();
  const current = store.getCatalog();
  console.log(
    live
      ? `Catalog: ${current.upgrades.length} upgrades and ${current.weapons.length} weapons from the game.`
      : `Catalog: offline copy (${current.upgrades.length} upgrades). Start the game and tournament servers to sync.`,
  );
}

// Keeps the "displays connected" line honest, and reads the catalog again once
// the game is up.
async function pingTournament() {
  await tournament.ping();
  if (tournament.link.host?.reachable && store.getCatalog().source !== 'game') await refreshCatalog();
}

party.listen(PORT, () => {
  console.log(`Quiz server on port ${PORT} (${['localhost', ...lanAddresses()].join(', ')})`);
  const source = party.adminKeyFile
    ? `stored in ${path.relative(process.cwd(), party.adminKeyFile)} — delete that file for a new one`
    : 'from ADMIN_KEY';
  console.log(`\n  Admin key: ${party.adminKey}  (${source})\n  The host enters it on /admin.`);
  console.log(`  Tournament API: ${tournament.TOURNAMENT_API}`);
});

// Read the game's catalog, then keep an eye on the tournament service and the
// game from here on. A battle that was playing carries on by itself: the
// tournament service runs it.
void pingTournament();
setInterval(() => void pingTournament(), 2_000).unref();
// The tournament was deleted on the service (or the service lost it).
tournament.onDeleted((id) => {
  if (store.state.tournamentId === id) store.setTournament(null);
});
