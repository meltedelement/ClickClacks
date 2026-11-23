// The word game's pieces: the board of guesses, the keyboard, a guess's marks
// with no letters (for the host screen), and the countdown. Also the final
// royale's banner and results. Built with the royale's helpers, like the bracket's pieces.
import { dot, h, ordinal } from '/ui.js';

export const WORD_LENGTH = 5;
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function tile(letter, mark) {
  return h(`span.tile${mark ? `.${mark}` : ''}${letter && !mark ? '.typed' : ''}`, letter ? letter.toUpperCase() : '');
}

// Past guesses, then (while guessing) the row being typed.
export function board(guesses, typed = null) {
  const rows = guesses.map((g) => h('div.word-row', {}, [...g.word].map((letter, i) => tile(letter, g.marks[i]))));
  if (typed !== null) rows.push(h('div.word-row.active', {}, Array.from({ length: WORD_LENGTH }, (_, i) => tile(typed[i] ?? '', null))));
  return h('div.word-board', {}, rows);
}

export function keyboard(hints, onKey) {
  const key = (k, label = k.toUpperCase(), wide = false) =>
    h(`button.key${wide ? '.wide' : ''}${hints[k] ? `.${hints[k]}` : ''}`, { type: 'button', onclick: () => onKey(k), 'aria-label': label }, label);
  return h('div.keyboard', {},
    h('div.key-row', {}, [...KEY_ROWS[0]].map((k) => key(k))),
    h('div.key-row', {}, [...KEY_ROWS[1]].map((k) => key(k))),
    h('div.key-row', {}, key('Enter', 'Guess', true), [...KEY_ROWS[2]].map((k) => key(k)), key('Backspace', '⌫', true)));
}

// Coloured squares only: what someone's guess scored, without giving away letters.
export function marksOnly(marks) {
  return h('span.marks-only', { 'aria-label': `${marks.filter((m) => m === 'hit').length} in place, ${marks.filter((m) => m === 'near').length} elsewhere` },
    marks.map((m) => h(`span.mini.${m}`)));
}

// What this break paid, in a sentence.
export function earnedText(word) {
  if (word.status === 'missed') return 'Time ran out before you guessed. Nothing this break.';
  if (!word.earned) return null;
  const { upgrades, transformation } = word.earned;
  if (transformation) return `You got it! A second transformation and ${upgrades} upgrades.`;
  if (word.status === 'solved') return `Already solved: ${upgrades} upgrades this break.`;
  if (upgrades === 0) return 'No letters this time. Nothing this break.';
  return `That guess paid ${upgrades} ${upgrades === 1 ? 'upgrade' : 'upgrades'}.`;
}

export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A countdown in `node` to `deadline` (Date.now() time); null stops it.
export function countdown(node) {
  let deadline = null;
  setInterval(tick, 250);
  function tick() {
    node.hidden = deadline === null;
    if (deadline !== null) node.textContent = clock(deadline - Date.now());
  }
  return (msLeft) => {
    deadline = msLeft === null || msLeft === undefined ? null : Date.now() + msLeft;
    tick();
  };
}

// ---- The final royale ------------------------------------------------------

// Over the arena once the royale is on (null before, so the champion's banner shows first).
export function royaleBanner(royale) {
  if (!royale || royale.status === 'soon' || royale.status === 'failed') return null;
  const label = royale.status === 'fighting' ? 'Fighting now' : 'Royale over';
  const title = royale.status === 'done' ? `${royale.winner?.name ?? '?'} wins the royale` : 'The final royale';
  return h('.round-banner', {},
    h('div.round-label', label),
    h('div.round-name', title),
    h('div.round-stage', `Everyone · ${royale.balls} balls · the builds they finished with`));
}

// The royale's part of the end screen: when it drops, then who won it and the places.
export function royaleSection(royale, youId, dropTimer) {
  if (!royale) return null;
  if (royale.status === 'failed') return h('p.notice', royale.error ?? 'The royale did not play.');
  if (royale.status === 'soon') {
    return h('.section.stack', {},
      h('.eyebrow', 'The final royale'),
      h('p.muted', 'One more fight: everyone, out or not, in one arena with the build they finished with. It has its own winner.'),
      dropTimer);
  }
  if (royale.status === 'fighting') {
    return h('.section.stack', {},
      h('.eyebrow', `The final royale · ${royale.balls} balls`),
      h('p.muted', 'Everyone is in the arena. Last ball standing wins the royale.'));
  }
  const mine = royale.places.find((p) => p.id === youId);
  return h('.section.stack', {},
    h('.eyebrow', `The final royale · ${royale.balls} balls${royale.seconds === null ? '' : ` · ${Math.round(royale.seconds)} s`}`),
    mine?.place === 1
      ? h('div.big-place.won', 'You won the royale!')
      : h('div.stack', {}, h('p.muted', 'Royale winner'), h('div.champion-name', royale.winner?.name ?? '?')),
    mine && mine.place !== 1 ? h('p.muted', `You came ${ordinal(mine.place)} of ${royale.balls}.`) : null,
    h('ul.rows', {}, royale.places.map((p) =>
      h(`li.row${p.id === youId ? '.you' : ''}`, {},
        h('span.place', ordinal(p.place)),
        dot(p.color),
        h('span.grow', p.name, h('span.build', p.build.join(' · ')))))));
}
