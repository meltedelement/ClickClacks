# Weapon Balls Quiz

The quiz side of Weapon Balls. Teams answer multiple choice questions on their phones. Each correct answer gives the team one upgrade pick. When the quiz reaches the battle phase the quiz server drives the game's match API (see [Battle](#battle)).

## Run

```sh
npm install
npm run dev     # API server (port 3001) + Vite client (port 5174), with reload
npm run build && npm start   # one server on port 3001 that serves the built client
```

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
| `data/game.json` | Offline copy of the game's weapons and upgrades, plus the quiz's `upgradesPerCorrect`, `offerSize` and `exclude`. Generated from the game by `npm run sync-catalog`. At run time the quiz reads the real catalog from the game's `GET /api/catalog`. |
| `data/admin-token.txt` | The generated admin key. Not in git. |
| `data/state.json` | Live state: teams, answers, and upgrades. The server writes it after each change. Not in git. |

The server reads the questions one time into `state.json`. After you edit `quiz-questions.json`, click **Reload quiz-questions.json** on the admin page.

To start a new quiz, delete `state.json` or use a reset button on the admin page.

## Quiz flow

The host moves through these phases on the admin page:

1. **lobby**: Teams join with a name and a weapon. Teams can change their weapon only in this phase.
2. **question**: Teams answer. A team can change its answer until the host closes answers.
3. **locked**: Answers are closed.
4. **reveal**: Teams see the correct answer. Each team that got it right sees `offerSize` random upgrades and picks one immediately.
5. **battle**: The game runs.

Picks are calculated again from the answers each time. Picks left = correct revealed answers × `upgradesPerCorrect` + bonus picks − picks used. Thus, if you change an answer or a "revealed" box on the admin page, the pick count is correct immediately.

## Live updates and poor connections

The server pushes the full state to each device with server-sent events (`/api/events`). There is no polling. Each action is a normal `POST`.

- The server sends a ping event every 15 seconds. If a device gets nothing for 35 seconds, it opens a new connection.
- A device also connects again when the page becomes visible or the network comes back.
- A `POST` stops after 10 seconds with an error. The buttons stay disabled until the server replies.
- A pick includes the `picksUsed` value that the device saw. Thus, a repeated pick is rejected and does not use a second pick.

## Presenter view

`/present` shows the current question and the teams. Show it on a projector or a shared screen.

- It never shows which team answered or what a team chose. It shows only the number of teams that answered.
- On the reveal, it shows the correct option and the percentage of votes for each option.
- The next button moves the quiz one step: question → locked → reveal → next question. After the last question, it starts the battle.
- Before the first question of a round, the next button shows the round title: the round number, the round name, and the number of questions. The next press opens the first question. Only the presenter view shows the round title. The phase does not change, and the teams see no change.
- A round is a group of consecutive questions with the same round in `quiz-questions.json`. The phones, the presenter view, and the admin page show the round and the question number in the round.
- Space, Enter, the right arrow, and Page Down also do the next step. A presentation clicker sends one of these keys.

## Dev controls (admin page)

- Set any phase or question directly.
- Change or clear any team's answer for any question.
- Mark a question as revealed or not revealed.
- Edit a team: name, weapon, bonus picks, and upgrade counts.
- Reroll a team's upgrade offer. Delete a team.
- Show a banner message to all teams. Lock the weapon choice in the lobby.
- Change a team's weapon at any time (teams can change it only in the lobby).
- Reload the questions. Reset the quiz, with or without the teams.
- See the raw state. Copy the loadouts JSON.

A team that loses its device can rejoin with the same team name and the team code. The team page and the admin page show the code.

## Game interface

`GET /api/loadouts` returns one entry for each team:

```json
[{ "team": "Alpha", "weapon": "sword", "upgrades": { "damage": 2, "hp": 1 } }]
```

The quiz stores only upgrade ids and counts. The game decides what each upgrade does.

## Battle

When the quiz reaches the `battle` phase the quiz server runs a round-robin
through the game's match API: every team fights every other team once, one match
at a time, and the standings rank by most wins.

- Start it with the presenter's **Start battle** button, or **Start battle** on
  the admin page. Moving the phase to `battle` starts it automatically.
- The game server must be running and its display page must be open and visible
  on the big screen: `http://localhost:3002/?display` after
  `npm run build && npm start` in the repo root, or `http://localhost:5173/?display`
  under `npm run dev`. A match only plays while a display page is connected, and
  the admin page shows how many are.
- Point the quiz at the game with `GAME_API` (default `http://localhost:3002/api`).
  The admin page shows the address and whether it answers.
- Loadouts are copied when the battle starts, so a later change on the admin
  page does not change a match that is already set. **Resync loadouts** copies
  the current loadouts into the matches that have not been played yet.
- A win is 1 point, a draw 0.5. Ties are broken by HP difference, then team
  name. A match still going at the game's time limit is a draw.
- Results are kept in `state.json`, so restarting the quiz server does not lose
  them and an interrupted battle carries on. The game keeps its matches in
  memory only, so if the game server restarts the match on screen is queued
  again with the same seed — the same fight.
- **Stop** cancels the match on screen. **Skip** gives up on one match; it is
  cancelled, not drawn, so it never counts in the table.

The quiz takes its weapons and upgrades from the game's `GET /api/catalog`, so
an offer can never name an upgrade the game does not know. If the game is not
running the quiz uses `data/game.json` and switches to the live catalog as soon
as the game answers. Run `npm run sync-catalog` after changing a weapon, upgrade
or stack limit in the game to refresh that offline copy.
