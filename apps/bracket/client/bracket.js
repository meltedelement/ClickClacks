// Pieces both pages draw: the stage's bracket, the match on now, the final
// standings and a player's status line. Built with the royale's helpers.
import { dot, h, ordinal } from '/ui.js';

function sideName(side, winner, youId) {
  const classes = ['vs-side'];
  if (winner && winner === side.id) classes.push('won');
  else if (winner) classes.push('lost');
  if (side.id === youId) classes.push('you');
  return h(`span.${classes.join('.')}`, {}, dot(side.color ?? '#757575'), side.name);
}

const STATUS = { pending: 'Later', queued: 'Up soon', playing: 'Fighting now', cancelled: 'Cancelled', failed: 'Failed' };

function matchRow(match, youId) {
  const result = match.status === 'done' ? (match.how ? `Won ${match.how}` : 'KO') : STATUS[match.status] ?? '';
  return h(`li.row.vs${match.status === 'playing' ? '.on-now' : ''}`, {},
    h('span.grow.vs-pair', {}, sideName(match.a, match.winner, youId), h('span.vs-word', 'vs'), sideName(match.b, match.winner, youId)),
    h(`span.side${match.status === 'playing' ? '.good' : ''}`, result));
}

export function bracketSection(bracket, youId = null) {
  return h('.section.stack', {},
    h('.eyebrow', `${bracket.format} · Stage ${bracket.stage} of ${bracket.stages}`),
    bracket.groups.map((group) =>
      h('.stack', {},
        h('div.group-name', group.name),
        group.pending && group.matches.length === 0
          ? h('p.muted', 'Drawn when the winners round is done.')
          : h('ul.rows', {}, group.matches.map((m) => matchRow(m, youId))))));
}

// The round in big letters, over the arena: what is being played right now.
export function roundBanner(bracket, phase) {
  const label = phase === 'done' ? 'Tournament over' : phase === 'picking' ? 'Up next' : bracket.roundMatch ? `Match ${bracket.roundMatch.n} of ${bracket.roundMatch.of}` : 'Now';
  const title = phase === 'done' ? `${bracket.champion?.name ?? '?'} wins` : bracket.round;
  return h('.round-banner', {},
    h('div.round-label', label),
    h('div.round-name', title),
    h('div.round-stage', `Stage ${bracket.stage} of ${bracket.stages} · ${bracket.format}`));
}

// The card over the arena when a match ends: who won, and how.
export function winCard(card, youId = null) {
  const youWon = card.winner.id === youId;
  const youLost = card.loser.id === youId;
  const hp = card.hpLeft === null ? '' : ` · ${Math.max(1, Math.ceil(card.hpLeft))} HP left`;
  const how = card.how === 'host'
    ? 'Decided by the host'
    : card.how === 'hp'
      ? `Won on HP at the time limit${hp}`
      : `KO${card.seconds === null ? '' : ` in ${Math.round(card.seconds)} s`}${hp}`;
  const node = h('.win-card', {},
    h('div.win-round', card.round),
    h('div.win-name', youWon ? 'You win!' : `${card.winner.name} wins!`),
    h('div.win-beat', youLost ? `You lost to ${card.winner.name}` : `beat ${card.loser.name}`),
    h('div.win-how', how));
  node.style.setProperty('--winner', card.winner.color ?? 'var(--accent)'); // a custom property needs setProperty
  return node;
}

export function nowPlaying(bracket) {
  if (!bracket.now) return null;
  const { now, next } = bracket;
  return h('.stack.now', {},
    h('.eyebrow', `${now.status === 'playing' ? 'Fighting now' : 'Up first'} · ${now.round}`),
    h('div.now-pair', {}, sideName(now.a, null, null), h('span.vs-word', 'vs'), sideName(now.b, null, null)),
    next ? h('p.muted', `Then ${next.a.name} vs ${next.b.name}${next.round !== now.round ? ` (${next.round})` : ''}`) : null);
}

export function standings(bracket, youId = null) {
  return h('ul.rows', {}, bracket.standings.map((s) =>
    h(`li.row${s.id === youId ? '.you' : ''}`, {},
      h('span.place', ordinal(s.rank)),
      dot(s.color ?? '#757575'),
      h('span.grow', s.name, h('span.build', s.build.join(' · '))),
      h('span.side', `${s.wins}–${s.losses}`))));
}

// One sentence on where a player stands, from the tournament's progress.
export function statusText(progress, format) {
  const text = statusSentence(progress, format);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusSentence(progress, format) {
  const { state, opponent, bracket, wins, losses } = progress;
  const where = bracket ? `${bracket}: ` : '';
  let lives = '';
  if (format === 'double-elimination' && bracket && !/^grand final/i.test(bracket)) lives = losses === 0 ? ' You have not lost yet.' : ' One more loss and you are out.';
  else if (format === 'single-elimination') lives = ' One loss and you are out.';
  else if (format === 'round-robin') lives = ` ${wins} won, ${losses} lost so far.`;
  switch (state) {
    case 'champion': return 'You won the tournament!';
    case 'out': return 'You are out. Stay and watch who wins it.';
    case 'lost': return `You lost against ${opponent}.${lives}`;
    case 'through': return `You beat ${opponent}.${format === 'round-robin' ? lives : ''}`;
    case 'dropped': return `You lost against ${opponent} and drop to the losers bracket.${lives}`;
    case 'bye': return `${where}no match for you this stage.${lives}`;
    case 'fighting': return `${where}you are fighting ${opponent} now!`;
    case 'next': return `${where}your match is drawn when the winners round is done.${lives}`;
    case 'waiting': return `${where}you fight ${opponent} this stage.${lives}`;
    default: return '';
  }
}
