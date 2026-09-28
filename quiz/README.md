# Weapon Balls Quiz

The quiz side of Weapon Balls. Teams answer multiple choice questions on their phones. Each correct answer gives the team one upgrade pick. The game reads each team's weapon and upgrades from `/api/loadouts`.

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
| `data/game.json` | Weapons, upgrades, `upgradesPerCorrect`, and `offerSize`. The ids must match the game. |
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
