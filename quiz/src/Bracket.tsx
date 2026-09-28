// The knockout bracket: one column per round, with the rounds that are not
// drawn yet as empty slots. Used by the admin page (with buttons per match)
// and the presenter view.
import type { ReactNode } from 'react';
import type { Battle, BattleMatch } from '../shared/types.ts';
import { roundMatches, roundName } from '../shared/battle.ts';

interface BracketProps {
  battle: Battle;
  teamName: (id: string) => string;
  actions?: (match: BattleMatch) => ReactNode; // admin buttons under a match
}

export function Bracket({ battle, teamName, actions }: BracketProps) {
  const planned = plannedRounds(battle.rounds[0]?.teams.length ?? 0);
  const current = battle.rounds.length - 1;

  return (
    <div className="bracket">
      {planned.map((size, index) => {
        const round = battle.rounds[index];
        const name = round?.name ?? roundName(size, index);
        return (
          <section key={index} className={index === current && !battle.champion ? 'bracket-round current' : 'bracket-round'}>
            <h3 className="eyebrow">
              {name}
              {round && index === current && !battle.champion && <span className="bracket-state"> · {round.status === 'playing' ? 'playing' : round.status === 'waiting' ? 'waiting for the host' : 'done'}</span>}
            </h3>
            <div className="bracket-slots">
              {round ? (
                <>
                  {roundMatches(battle, index).map((match) => (
                    <MatchCard key={match.id} match={match} teamName={teamName} waiting={round.status === 'waiting'} actions={actions?.(match)} />
                  ))}
                  {round.bye && (
                    <div className="bracket-match bye">
                      <div className="bracket-team won">
                        <span>{teamName(round.bye)}</span>
                      </div>
                      <div className="bracket-meta">Bye: through to the next round</div>
                    </div>
                  )}
                </>
              ) : (
                Array.from({ length: Math.floor(size / 2) + (size % 2) }, (_, i) => (
                  <div key={i} className="bracket-match empty">
                    <div className="bracket-team faint">–</div>
                    {i < Math.floor(size / 2) && <div className="bracket-team faint">–</div>}
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MatchCard({ match, teamName, waiting, actions }: { match: BattleMatch; teamName: (id: string) => string; waiting: boolean; actions?: ReactNode }) {
  const done = match.status === 'done';
  const live = match.status === 'queued';
  const side = (id: string, i: 0 | 1) => {
    const classes = ['bracket-team'];
    if (done) classes.push(match.winner === id ? 'won' : 'lost');
    return (
      <div className={classes.join(' ')}>
        <span>{teamName(id)}</span>
        {done && match.hp && <span className="num faint">{Math.round(match.hp[i])} HP</span>}
      </div>
    );
  };

  let meta: ReactNode;
  if (done) {
    const how = match.decidedBy === 'hp' ? 'Won on HP at the time limit' : match.decidedBy === 'host' ? 'Decided by the host' : 'Knockout';
    meta = `${how}${match.time !== null && match.decidedBy !== 'host' ? ` · ${Math.round(match.time)} s` : ''}`;
  } else if (live) meta = 'On the game now';
  else if (match.status === 'pending') meta = waiting ? 'Up next' : 'Waiting for a display';
  else meta = <span className="error">{match.error ?? match.status}</span>;

  return (
    <div className={live ? 'bracket-match live' : 'bracket-match'}>
      {side(match.a, 0)}
      {side(match.b, 1)}
      <div className="bracket-meta">
        <span className="faint num">{match.id}</span> {meta}
      </div>
      {actions && <div className="bracket-actions">{actions}</div>}
    </div>
  );
}

// Team count of each round, from the first round to the final: each round
// halves the field, and a bye carries the odd team out.
function plannedRounds(teams: number): number[] {
  const sizes: number[] = [];
  for (let size = teams; size > 1; size = Math.ceil(size / 2)) sizes.push(size);
  return sizes;
}
