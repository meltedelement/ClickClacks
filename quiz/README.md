# Weapon Balls Quiz

The quiz side of Weapon Balls. Teams answer multiple choice questions on their phones. Each correct answer gives the team one upgrade pick. The game reads each team's weapon and upgrades from `/api/loadouts`.

## Run

```sh
npm install
npm run dev     # API server (port 3001) + Vite client (port 5174), with reload
npm run build && npm start   # one server on port 3001 that serves the built client
```

- Teams open `http://<your-ip>:5174/` (dev) or `http://<your-ip>:3001/` (start).
- The host opens `/admin`.
- Set `ADMIN_KEY=something` to protect `/admin`. Without it, anyone can open the admin page.

## Data

| File | Content |
| --- | --- |
| `../quiz-questions.json` | The questions, in rounds. `answerIndex` is the index of the correct option. |
| `data/game.json` | Weapons, upgrades, `upgradesPerCorrect`, and `offerSize`. The ids must match the game. |
| `data/state.json` | Live state: teams, answers, and upgrades. The server writes it after each change. Not in git. |

The server reads the questions one time into `state.json`. After you edit `quiz-questions.json`, click **Reload quiz-questions.json** on the admin page.

To start a new quiz, delete `state.json` or use a reset button on the admin page.

## Quiz flow

The host moves through these phases on the admin page:

1. **lobby**: Teams join with a name and a weapon.
2. **question**: Teams answer. A team can change its answer until the host closes answers.
3. **locked**: Answers are closed.
4. **reveal**: Teams see the correct answer. Correct teams get a pick.
5. **upgrades**: Each team with picks gets `offerSize` random upgrades and selects one per pick.
6. **battle**: The game runs.

Picks are calculated again from the answers each time. Picks left = correct revealed answers × `upgradesPerCorrect` + bonus picks − picks used. Thus, if you change an answer or a "revealed" box on the admin page, the pick count is correct immediately.

## Dev controls (admin page)

- Set any phase or question directly.
- Change or clear any team's answer for any question.
- Mark a question as revealed or not revealed.
- Edit a team: name, weapon, bonus picks, and upgrade counts.
- Reroll a team's upgrade offer. Delete a team.
- Show a banner message to all teams. Lock the weapon choice.
- Reload the questions. Reset the quiz, with or without the teams.
- See the raw state. Copy the loadouts JSON.

A team that loses its device can rejoin with the same team name and the team code. The team page and the admin page show the code.

## Game interface

`GET /api/loadouts` returns one entry for each team:

```json
[{ "team": "Alpha", "weapon": "sword", "upgrades": { "damage": 2, "hp": 1 } }]
```

The quiz stores only upgrade ids and counts. The game decides what each upgrade does.
