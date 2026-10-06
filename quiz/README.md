# The Quiz of Doom

The quiz side of Weapon Balls. Teams answer multiple choice questions on their phones. Each correct answer gives the team one upgrade pick, which waits on the phone's Upgrades tab until the team takes it. After the rounds the host's [schedule](#battle-breaks) marks, the quiz stops for a battle break, and stages of the battle play through the [tournament service](../tournament/README.md) (see [Battle](#battle)). Breaks can come with a transformation pick.

## Run

```sh
npm install
npm run dev     # API server (port 3001) + Vite client (port 5174), with reload
npm run build && npm start   # one server on port 3001 that serves the built client
```

From the repo root, `npm run dev:all` (or `npm run start:all`, which builds
first) runs the quiz, the tournament service and the game together and points
each at the next for you. See the [main README](../README.md#running). You can
also run the quiz alone from here. Then set `TOURNAMENT_API` so that the battle
finds the tournament service (default `http://127.0.0.1:3003/api`). The quiz
never talks to the game itself.

- Teams open `http://<your-ip>:5174/` (dev) or `http://<your-ip>:3001/` (start).
- The host opens `/admin` and enters the admin key. The host runs the quiz from this page.
- The host shows `/screen` on the big screen (`/present` also works). It uses the same admin key; in the same browser as the admin page it is already signed in. Click it once: it goes fullscreen, and the arena can play sound.
- The server prints the admin key when it starts. It is random the first time and kept in
  `data/admin-token.txt` (not in git), so restarts keep the same key. Delete that file for a new key,
  or set `ADMIN_KEY=something` to choose one yourself.

## Data

| File | Content |
| --- | --- |
| `../quiz-questions.json` | The questions, in rounds. `answerIndex` is the index of the correct option. |
| `data/game.json` | Offline copy of the game's weapons, upgrades and transformations, plus the quiz's `upgradesPerCorrect`, `offerSize` and `exclude`. Generated from the game by `npm run sync-catalog`. At run time the quiz reads the real catalog from the game, through the tournament service's `GET /api/game/catalog`. |
| `data/admin-token.txt` | The generated admin key. Not in git. |
| `data/state.json` | Live state: teams, answers, upgrades, and the id of the battle on the tournament service. The server writes it after each change. Not in git. |

The server reads the questions one time into `state.json`. After you edit `quiz-questions.json`, click **Reload quiz-questions.json** on the admin page.

To start a new quiz, use **Full reset** on the admin page's Settings tab, or stop the server and delete `state.json`.

## Quiz flow

The host moves through these phases with the Next button on the admin page:

1. **lobby**: Teams join with a name, a colour and a weapon. Teams can change their colour and weapon only in this phase.

Each team has its own colour from a fixed palette of 16 (`shared/colors.ts`). A colour that another team has cannot be picked: the server rejects it, and the join form and lobby show it crossed out. The game draws the team's ball in that colour.
2. **question**: Teams answer. A team can change its answer until the host closes answers.
3. **locked**: Answers are closed.
4. **reveal**: Teams see the correct answer. Each team that got it right earns a pick: its Upgrades tab shows `offerSize` random upgrades. The pick waits, so the team can take it during the next questions.
5. **battle**: A battle break. It plays the stages the [schedule](#battle-breaks) gives it.

Picks are calculated again from the answers each time. Picks left = correct revealed answers × `upgradesPerCorrect` + bonus picks − picks used. Thus, if you change an answer or a "revealed" box on the admin page, the pick count is correct immediately.

## Live updates and poor connections

The server pushes the full state to each device with server-sent events (`/api/events`). Each action is a normal `POST`. The only polling is on the join form: it reads `GET /api/colors` every 3 seconds, because a device joins only after it picks a colour.

- The server sends a ping event every 15 seconds. If a device gets nothing for 35 seconds, it opens a new connection.
- A device also connects again when the page becomes visible or the network comes back.
- A `POST` stops after 10 seconds with an error. The buttons stay disabled until the server replies.
- A pick includes the `picksUsed` value that the device saw. Thus, a repeated pick is rejected and does not use a second pick.

## The three screens

- **Phones** (`/`): join, then two tabs. **Quiz** has the question and the battle status. **Upgrades** has the offers and the loadout. The tab bar counts the picks that wait, and marks the Quiz tab while a question is open that the team has not answered, so a team can read the offers at its own pace without missing a question. Neither tab opens by itself.
- **Big screen** (`/screen`): what the room sees. It has no controls. It shows the join address and the teams in the lobby, a title card before each round, the question, and after the reveal the correct option and the percentage of votes for each option. It never shows which team answered or what a team chose, only how many teams answered. In a battle break it shows the matches of the current stage, and while a stage plays it switches to the arena by itself (see [Battle](#battle)). Beside the arena a panel follows the stage: each match, its result as soon as it is decided, and for a match that is playing, a small map of the arena grid that marks which arena it is on. It follows the theme chosen on the admin page.
- **Admin** (`/admin`): the host's page, made for a laptop. See below.

## Admin page

The control bar at the top shows where the quiz is and what the big screen shows now. **Next** moves the quiz one step: round title → question → locked → reveal → next question. After the last question of a round that the schedule gives a break, it starts the battle break. In the break it starts the stage, and when the stage is done, **Back to the quiz** shows the next round title. **Back** hides the round title, or goes to the previous question.

- Before the first question of a round, Next shows the round title on the big screen: the round number, the round name, and the number of questions. The next press opens the first question. The phones do not change.
- A round is a group of consecutive questions with the same round in `quiz-questions.json`. The phones, the big screen, and the admin page show the round and the question number in the round.
- Space, Enter, the right arrow, and Page Down also do Next, unless you are typing in a field. A presentation clicker sends one of these keys. Keep the admin page focused.

Below the control bar are tabs:

- **Live**: the lobby, the current question with each team's answer, or in a battle break the bracket. On the side: which teams are online and which still have picks to use.
- **Teams**: every team's loadout. **Edit** opens a team's name, colour, weapon, bonus picks, upgrades, transformations and offer.
- **Answers**: every team's answer to every question.
- **Battle**: the bracket and its controls, and the schedule.
- **Settings**: the message banner, the lobby lock, jumping to a phase or question, reloading the questions and the catalog, data, and resets.

### Host controls

- Set any phase or question directly (Settings).
- Change or clear any team's answer for any question.
- Mark a question as revealed or not revealed.
- Edit a team: name, colour, weapon, bonus picks, upgrade counts, and transformations.
- Reroll a team's upgrade offer. Delete a team.
- Show a banner message to all teams. Lock the colour and weapon choice in the lobby.
- Change a team's colour or weapon at any time (teams can change them only in the lobby). A colour that another team has is disabled in the list.
- Add only the upgrades and transformations that fit the team's weapon. A new weapon removes the upgrades and transformations that do not fit it, and the ones that require them. The team gets those upgrade picks back.
- Reload the questions.
- **Full reset** (Settings): deletes all the data, as if `state.json` were deleted: teams (the phones go back to the join page), answers, upgrades, transformations, the bracket (its unfinished matches are taken off the game) and the message. The questions are read again. The admin key stays. **Start over, keep the teams** does the same but keeps each team's name, colour and weapon.
- See the raw state. Copy the loadouts JSON.

A team that loses its device can rejoin with the team code only. Tap "Rejoin with a team code" on the join page. The team page and the admin page show the code.

## Game interface

`GET /api/loadouts` returns one entry for each team:

```json
[{ "team": "Alpha", "color": "#e5484d", "weapon": "sword", "upgrades": { "damage": 2, "hp": 1 }, "transformations": ["captain"] }]
```

The quiz stores only upgrade ids and counts, and the transformation ids. The game decides what each one does.

## Battle

The battle runs on the [tournament service](../tournament/README.md), which
sends every match to the game. The quiz sends it the teams as entrants (with a
public id per team, never the device token) and their loadouts, starts each
stage, and shows what it reports. The battle is played in stages, one stage in
each battle break.

The default format is a double elimination: a team is out after its second
loss. Before the bracket is drawn, the Battle tab can pick single elimination
(out after one loss) or round robin (everyone meets everyone, and the top of
the table wins) instead. The rules below are the double elimination's; the
tournament service's README has the others.

### Battle breaks

The **Schedule** card on the Battle tab has one row per round. For each round
the host picks what follows it: no break, a break that plays 1 to 10 stages,
or a break that plays all the stages left. Each break can also give a
transformation pick. Changes apply at once and are kept in `state.json`; a
reset keeps them, and reloading questions with another number of rounds goes
back to the default.

- The last round always ends with a break that plays the stages left, until
  there is a champion. A break that plays the rest earlier ends the battle
  there, and the rounds after it have no break.
- The default is a one-stage break after every second round, and the rest
  after the last round. **Restore the default** on the card goes back to it.
- Once the bracket is drawn, the card shows which stages each break plays.
- If the battle ends before the quiz, Next skips the breaks that are left.
- The host can start a stage on the Battle tab at any time, also outside a break.

| Teams | Stages |
| --- | --- |
| 16 | 6 (+1 if the grand final is reset) |
| 8 | 5 (+1) |
| 6 | 5 (+1) |
| 4 | 3 (+1) |

With the default schedule, 7 rounds and 8 teams, stages 1 to 3 play after
rounds 2, 4 and 6, and stages 4 and 5 after round 7.

### Transformations

Transformations are the big upgrades that reshape a weapon. The quiz never
offers them for correct answers. Instead, each break that the schedule marks
gives every team that is still in the battle one transformation pick. The pick
shows on the Upgrades tab as soon as the quiz is past the break before it (for
the first break, from the first question), so teams can choose during the
questions that lead up to it. By default the first break, every other break
after it, and the last break give one. The phone shows 3 random
transformations from the ones that fit the team's weapon. The offer stays the
same until the team picks. The team keeps every transformation it picks. A
pick that the team does not use carries over. A weapon with no
transformations gets no pick. The big screen (in a break) and the admin page
show the teams that still have to pick. The host does not have to wait for them.

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

1. Start the game server and the tournament service (`npm run start:all` or
   `npm run dev:all` in the repo root does it for you) and open `/screen` on
   the big screen. The big screen
   loads the game's display page (`?display&embed`) as soon as the game
   answers and keeps it loaded, hidden, so it counts as a connected display.
   A match plays only while a display page is connected, so keep the big
   screen visible. The Battle tab shows how many are connected.
2. At the first battle break, the quiz moves to the `battle` phase. This draws
   the bracket. You can also click **Draw the bracket** on the Battle tab.
3. Start each stage with Next (**Start stage 1**) or on the Battle tab. The
   tournament service sends all winners bracket matches of the stage to the
   game at the same time. The big screen switches to the arena, which plays up
   to four at once. When they all have a winner, it sends the losers bracket
   matches. A few seconds after the stage ends, the big screen goes back to the
   stage's results.
4. When all the matches of a stage have a winner, the tournament service draws
   the next stage and waits. Nothing plays until you start it. The admin page
   can start a stage at any time, also outside a battle break.

Point the quiz at the tournament service with `TOURNAMENT_API` (default
`http://127.0.0.1:3003/api`), and the tournament service at the game with its
`GAME_API`. The Battle tab shows whether each answers and the number of display
pages. **Arena alone** there opens the display page on its own, for a second
screen.

### Battle controls (Battle tab)

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

- The quiz sends each team's name, colour and loadout to the tournament service
  whenever they change, and again just before a stage starts. A stage copies
  the loadouts when it starts; the losers bracket matches get them when they
  are drawn. Thus, upgrades and transformations picked between stages apply to
  the next stage.
- The game checks every loadout (through the tournament service). A team's
  **Edit** panel shows the game's reasons to refuse its loadout once the
  bracket is drawn, and a stage with such a team does not start. A loadout
  the game refuses mid-stage fails only that match: fix it, then replay the
  match or pick its winner.
- The bracket and the results are kept by the tournament service (in
  `tournament/data/`); `state.json` keeps only the battle's id. If the quiz
  server restarts, it picks the battle up again. If the tournament service
  restarts, a stage that was playing continues.
- The game keeps its matches in memory only. If the game server restarts, the
  tournament service sends the unfinished matches again with the same seeds:
  the same fights.
- A `state.json` from before the tournament service had the bracket in it. The
  quiz drops that bracket when it starts; draw a new one.

The quiz takes its weapons, upgrades and transformations from the game's
catalog (through the tournament service), so an offer can never name an
upgrade the game does not know. If the game is not running the quiz uses
`data/game.json` and switches to the live catalog as soon as the game answers. Run `npm run sync-catalog` after changing a weapon, upgrade
or stack limit in the game to refresh that offline copy.
