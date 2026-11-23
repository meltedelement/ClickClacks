# Letter Brawl

The [bracket](../bracket/README.md) with a word game between stages. Everyone
drafts a weapon and a transformation on their phone and fights 1v1 through a
tournament (double elimination by default). Before the first stage and between
stages, everyone still in takes **one guess** at a hidden five-letter word, and the guess pays upgrades.

## Running it

```sh
npm run brawl            # port 8080 (npm run brawl -- 9000 for another)
```

The same as `npm run tournament`, with this app in place of the bracket: the game
(3006) and a tournament service (3007) run privately, and this app on the port
everyone joins. The server needs internet access for the words (see below).

## The rules

- **Lobby.** Join, choose a weapon, take one of three transformations. The host
  starts the tournament.
- **The first break**, before stage 1: everyone has their weapon and
  transformation (unfinished drafts are completed at random), then guesses.
- **Each break** (the first, and every one between stages): everyone still in has the same word and **two
  minutes for one guess**. Each guess is marked like the usual word game:
  - a letter in the right place (green) pays **2 upgrades**,
  - a letter in the word but elsewhere (yellow) pays **1 upgrade**,
  - **solving it** pays a **transformation** (picked first) on top of the 10.
- **Once solved, it stays solved:** no more guesses, and every later break pays
  the full 10 upgrades.
- The word carries on from break to break, so each guess builds on the last.
  Every upgrade is a pick of 1 from 3, like the bracket.
- The stage starts by itself once everyone still in has guessed (or run out of
  time) and taken their picks. The host can start it sooner: guesses close and
  unfinished picks are made at random.
- **The final royale.** Once the tournament has its champion, everyone who
  played in it (knocked out or not) fights one battle royale with the build
  they finished with, about ten seconds later, on every phone (each following
  its own ball). Its winner is a second winner of the night, separate from the
  champion. Starting a new tournament cancels it.
- Only the solver's phone shows the word. The host page shows each player's
  marks as coloured squares, with no letters. Everyone sees the word when the
  tournament ends.

## Words

`server/words.ts`. Both APIs are open and need no key:

- **The answer**: a past New York Times Wordle answer, from a random day of its
  archive (`https://www.nytimes.com/svc/wordle/v2/<yyyy-mm-dd>.json`). It is
  fetched ahead, so a tournament starts at once. Offline, it comes from a short
  built-in list.
- **Is a guess a word**: the Free Dictionary API
  (`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`), cached for the
  night. A 404 means not a word. If the API can't be reached, the guess is
  allowed, so a round never stalls.

## How it fits together

It is the bracket's store with different rules between stages. `createBracket`
(`apps/bracket/server/store.ts`) takes optional `rules` (`StageRules`: what a
new stage gives the players still in it, what else a player owes before it
starts, and a lobby reset). `server/store.ts` supplies them and adds the word to
each view, and plays the final royale straight on the game's Match Host API
(`GameHost` from the royale's `server/host.ts`), since the tournament service
only plays 1v1s. It borrows the bracket's tournament client, `bracket.js` and
`bracket.css` by path, and through them the royale's draft, `ui.js` and
`style.css`: a change there shows here too.

- `shared/word.ts`: marking a guess (repeated letters as in the usual game), what it pays. Pure, tested.
- `server/store.ts`: the word rules on top of the bracket, and the final royale; `store.test.ts` plays breaks and the royale against a fake service, game and dictionary.
- `server/words.ts`: the two APIs.
- `client/`: `phone.html` (the board and an on-screen keyboard; a real keyboard works too), `admin.html`, `letters.js` (also the royale's banner and places)/`letters.css`.

## Checks

```sh
npm test            # in this folder, or from the root with everything else
npm run typecheck   # borrows the quiz's TypeScript
```
