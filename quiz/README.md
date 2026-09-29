# Weapon Balls Quiz

The quiz side of Weapon Balls. Teams answer multiple choice questions on their phones. Each correct answer gives the team one upgrade pick. After every second round, the quiz stops for a battle break: each team picks a transformation, and one stage of a double elimination plays through the game's match API (see [Battle](#battle)).

## Run

```sh
npm install
npm run dev     # API server (port 3001) + Vite client (port 5174), with reload
npm run build && npm start   # one server on port 3001 that serves the built client
```

From the repo root, `npm run dev:all` (or `npm run start:all`, which builds both
first) runs the quiz and the game together and points the quiz at the match API
for you. See the [main README](../README.md#running). You can also run the quiz
alone from here. Then set `GAME_API` so that the battle finds the game
(`GAME_API=http://localhost:5173/api npm run dev`, or the built `:3002`).

- Teams open `http://<your-ip>:5174/` (dev) or `http://<your-ip>:3001/` (start).
- The host opens `/admin` and enters the admin key.
- The host shows `/present` on the big screen. It uses the same admin key.
- The server prints the admin key when it starts. It is random the first time and kept in
  `data/admin-token.txt` (not in git), so restarts keep the same key. Delete that file for a new key,
  or set `ADMIN_KEY=something` to choose one yourself.

## Data

| File | Content |
| --- | --- |
| `../quiz-questions.json` | The questions, in rounds. `answerIndex` is the index of the correct option. |
| `data/game.json` | Offline copy of the game's weapons, upgrades and transformations, plus the quiz's `upgradesPerCorrect`, `offerSize` and `exclude`. Generated from the game by `npm run sync-catalog`. At run time the quiz reads the real catalog from the game's `GET /api/catalog`. |
| `data/admin-token.txt` | The generated admin key. Not in git. |
| `data/state.json` | Live state: teams, answers, and upgrades. The server writes it after each change. Not in git. |

The server reads the questions one time into `state.json`. After you edit `quiz-questions.json`, click **Reload quiz-questions.json** on the admin page.

To start a new quiz, delete `state.json` or use a reset button on the admin page.

## Quiz flow

The host moves through these phases on the admin page:

1. **lobby**: Teams join with a name, a colour and a weapon. Teams can change their colour and weapon only in this phase.

Each team has its own colour from a fixed palette of 16 (`shared/colors.ts`). A colour that another team has cannot be picked: the server rejects it, and the join form and lobby show it crossed out. The game draws the team's ball in that colour.
2. **question**: Teams answer. A team can change its answer until the host closes answers.
3. **locked**: Answers are closed.
4. **reveal**: Teams see the correct answer. Each team that got it right sees `offerSize` random upgrades and picks one immediately.
5. **battle**: A battle break. Teams pick a transformation, and one stage of the bracket plays. It comes after every second round and after the last round.

Picks are calculated again from the answers each time. Picks left = correct revealed answers × `upgradesPerCorrect` + bonus picks − picks used. Thus, if you change an answer or a "revealed" box on the admin page, the pick count is correct immediately.

## Live updates and poor connections

The server pushes the full state to each device with server-sent events (`/api/events`). Each action is a normal `POST`. The only polling is on the join form: it reads `GET /api/colors` every 3 seconds, because a device joins only after it picks a colour.

- The server sends a ping event every 15 seconds. If a device gets nothing for 35 seconds, it opens a new connection.
- A device also connects again when the page becomes visible or the network comes back.
- A `POST` stops after 10 seconds with an error. The buttons stay disabled until the server replies.
- A pick includes the `picksUsed` value that the device saw. Thus, a repeated pick is rejected and does not use a second pick.

## Presenter view

`/present` shows the current question and the teams. Show it on a projector or a shared screen.

- It never shows which team answered or what a team chose. It shows only the number of teams that answered.
- On the reveal, it shows the correct option and the percentage of votes for each option.
- The next button moves the quiz one step: question → locked → reveal → next question. After the last question of every second round, and of the last round, it starts the battle. In the battle it starts the stage, and when the stage is done, **Back to the quiz** opens the next round.
- Before the first question of a round, the next button shows the round title: the round number, the round name, and the number of questions. The next press opens the first question. Only the presenter view shows the round title. The phase does not change, and the teams see no change.
- A round is a group of consecutive questions with the same round in `quiz-questions.json`. The phones, the presenter view, and the admin page show the round and the question number in the round.
- Space, Enter, the right arrow, and Page Down also do the next step. A presentation clicker sends one of these keys.

## Dev controls (admin page)

- Set any phase or question directly.
- Change or clear any team's answer for any question.
- Mark a question as revealed or not revealed.
- Edit a team: name, colour, weapon, bonus picks, upgrade counts, and transformations.
- Reroll a team's upgrade offer. Delete a team.
- Show a banner message to all teams. Lock the colour and weapon choice in the lobby.
- Change a team's colour or weapon at any time (teams can change them only in the lobby). A colour that another team has is disabled in the list.
- Reload the questions. Reset the quiz, with or without the teams.
- See the raw state. Copy the loadouts JSON.

A team that loses its device can rejoin with the team code only. Tap "Rejoin with a team code" on the join page. The team page and the admin page show the code.

## Game interface

`GET /api/loadouts` returns one entry for each team:

```json
[{ "team": "Alpha", "color": "#e5484d", "weapon": "sword", "upgrades": { "damage": 2, "hp": 1 }, "transformations": ["captain"] }]
```

The quiz stores only upgrade ids and counts, and the transformation ids. The game decides what each one does.

## Battle

The quiz server runs a double elimination through the game's match API. A team
is out after its second loss. The battle is played in stages, one stage in each
battle break.

### Battle breaks

- The quiz stops for a battle after every second round (`BATTLE_EVERY` in
  `shared/rounds.ts`) and after the last round.
- Each break plays one stage. The break after the last round plays the stages
  that are left, until there is a champion.
- If the battle ends before the quiz, the presenter skips the breaks that are left.

| Teams | Stages |
| --- | --- |
| 16 | 6 (+1 if the grand final is reset) |
| 8 | 5 (+1) |
| 6 | 5 (+1) |
| 4 | 3 (+1) |

With 7 rounds and 8 teams, stages 1 to 3 play after rounds 2, 4 and 6, and
stages 4 and 5 after round 7.

### Transformations

Transformations are the big upgrades that reshape a weapon. The quiz never
offers them for correct answers. Instead, before each stage, each team that is
still in the battle picks one transformation on its phone. The phone shows 3
random transformations from the ones that fit the team's weapon. The offer stays
the same until the team picks. The team keeps every
transformation it picks. A pick that the team does not use carries over. A
weapon with no transformations (mace, daggers) gets no pick. The presenter and
the admin page show the teams that still have to pick. The host does not have to
wait for them.

### The bracket

- The first stage is a random draw into the winners bracket, from a seed. The
  same seed and the same teams give the same draw and the same fights. The admin
  page shows the seed, and you can type one before you draw the bracket.
- A loss in the winners bracket moves the team to the losers bracket of the
  same stage. A loss in the losers bracket puts it out.
- A stage holds one round of each bracket. The winners bracket plays first.
  When all its matches have a winner, the quiz draws the losers bracket round
  of the stage and plays it. The display never shows the two brackets at the
  same time.
- So the losers bracket starts in stage 1: the teams that lose in the first
  winners round fight each other straight away.
- In each bracket, teams fight in pairs in order. With an odd number of teams,
  the last team gets a **bye**: no match in this stage. In the next stage, the bye
  team is listed first, so it always fights. A team never gets two byes in a row,
  except the last team of a bracket, which waits for the other bracket.
- In the losers bracket, the teams that won there meet the teams that just
  dropped from the winners bracket in the same stage.
- The last team of each bracket meet in the **grand final**. If the losers
  bracket team wins, the winners bracket team has its first loss, and a **grand
  final reset** decides the champion.
- Every match has a winner. The quiz sends each match with the game's `hp`
  tiebreak: at the time limit, or after a double KO, the team with more HP left
  (as a share of its max HP) wins. An exact tie is a coin flip from the match
  seed. The arena banner says "WINS ON HP".

### Running it

1. Start the game server and open its display page on the big screen:
   `http://localhost:3002/?display` after `npm run build && npm start` in the repo
   root, or `http://localhost:5173/?display` under `npm run dev`. Keep the page
   visible. A match plays only while a display page is connected.
2. At the first battle break, the quiz moves to the `battle` phase. This draws
   the bracket. You can also click **Draw the bracket** on the admin page.
3. Start each stage with the presenter's Next button (**Start stage 1**) or on
   the admin page. The quiz sends all winners bracket matches of the stage to
   the game at the same time. The display plays up to four at once. When they
   all have a winner, the quiz sends the losers bracket matches.
4. When all the matches of a stage have a winner, the quiz draws the next stage
   and waits. Nothing plays until you start it. The admin page can start a stage
   at any time, also outside a battle break.

Point the quiz at the game with `GAME_API` (default `http://localhost:3002/api`).
The admin page shows the address, whether it answers, and the number of display
pages.

### Host controls (admin page)

- **Stop the stage**: takes the stage's unfinished matches off the game. They
  wait until you start the stage again, with the same seeds.
- **Team wins**: you decide a match that is not on the game, for example one that
  failed. The match shows "Decided by the host".
- **Replay**: plays a match of the current stage again with a new seed. For the
  grand final, this also removes the champion.
- **Team wins** and **Replay** on a winners bracket match take back the losers
  bracket draw of the stage, because another team can drop. This is possible
  only while no losers match of the stage is on the game or has a result. Stop
  the stage first if the losers matches are on the game.
- **Reset battle**: removes the bracket and every result.

### Loadouts, restarts and errors

- The quiz copies each team's loadout when its stage starts. The losers bracket
  matches get the loadouts when they are drawn. Thus, upgrades and
  transformations picked between stages apply to the next stage.
- A loadout that the game refuses fails only that match. Fix the loadout, then
  replay the match or pick its winner.
- The bracket and the results are kept in `state.json`. If the quiz server
  restarts, a stage that was playing continues. The quiz picks up the matches
  that it already sent to the game.
- The game keeps its matches in memory only. If the game server restarts, the
  quiz sends the unfinished matches again with the same seeds: the same fights.

The quiz takes its weapons, upgrades and transformations from the game's
`GET /api/catalog`, so an offer can never name an upgrade the game does not know. If the game is not
running the quiz uses `data/game.json` and switches to the live catalog as soon
as the game answers. Run `npm run sync-catalog` after changing a weapon, upgrade
or stack limit in the game to refresh that offline copy.
