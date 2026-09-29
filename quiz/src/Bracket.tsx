// The double elimination bracket: one column per stage, the winners bracket in
// the top row and the losers bracket under it. The grand final spans both rows.
// Stages (and losers brackets) that are not drawn yet show as empty slots. Used by the admin page
// (with buttons per match).
import type { ReactNode } from 'react';
import type { Battle, BattleMatch, BracketSide, GameScreen } from '../shared/types.ts';
import { plannedStages, roundMatches } from '../shared/battle.ts';
import { TeamDot } from './ui.tsx';

interface BracketProps {
  battle: Battle;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
  actions?: (match: BattleMatch) => ReactNode; // admin buttons under a match
  onScreen?: Record<string, GameScreen>; // game match id -> its screen on the display page
}

const ROW: Record<BracketSide, string> = { winners: '2', losers: '3', final: '2 / span 2' };

export function Bracket({ battle, teamName, teamColor, actions, onScreen }: BracketProps) {
  const planned = plannedStages(battle.rounds[0]?.groups[0]?.teams.length ?? 0);
  const stages = Math.max(planned.length, battle.rounds.length);
  const current = battle.rounds.length - 1;

  return (
    <div className="bracket" style={{ gridTemplateColumns: `repeat(${stages}, minmax(13.125rem, 1fr))` }}>
      {Array.from({ length: stages }, (_, index) => {
        const round = battle.rounds[index];
        const live = index === current && !battle.champion;
        const column = String(index + 1);
        return [
          <h3 key={`h${index}`} className={live ? 'eyebrow bracket-head current' : 'eyebrow bracket-head'} style={{ gridColumn: column, gridRow: '1' }}>
            Stage {index + 1}
            {round && live && <span className="bracket-state"> · {round.status === 'playing' ? 'playing' : round.status === 'waiting' ? 'waiting for the host' : 'done'}</span>}
          </h3>,
          ...(round
            ? round.groups.map((group) => (
                <section key={`${index}${group.side}`} className={`bracket-group ${group.side}`} style={{ gridColumn: column, gridRow: ROW[group.side] }}>
                  <h4 className="bracket-group-name">{group.name}</h4>
                  {group.pending ? (
                    <div className="bracket-slots">
                      <EmptySlots size={planned[index]?.find((g) => g.side === group.side)?.size ?? group.teams.length} />
                      <div className="bracket-meta">Drawn when the winners bracket is finished</div>
                    </div>
                  ) : (
                    <div className="bracket-slots">
                      {roundMatches(battle, index)
                        .filter((match) => match.side === group.side)
                        .map((match) => (
                          <MatchCard
                            key={match.id}
                            match={match}
                            teamName={teamName}
                            teamColor={teamColor}
                            waiting={round.status === 'waiting'}
                            screen={match.gameId ? onScreen?.[match.gameId] : undefined}
                            screensKnown={onScreen !== undefined}
                            actions={actions?.(match)}
                          />
                        ))}
                      {group.bye && (
                        <div className="bracket-match bye">
                          <div className="bracket-team">
                            <TeamLabel name={teamName(group.bye)} color={teamColor(group.bye)} />
                          </div>
                          <div className="bracket-meta">{group.teams.length === 1 ? 'Waits for the other bracket' : 'Bye: no match this stage'}</div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ))
            : (planned[index] ?? []).map((group) => (
                <section key={`${index}${group.side}`} className={`bracket-group ${group.side}`} style={{ gridColumn: column, gridRow: ROW[group.side] }}>
                  <h4 className="bracket-group-name">{group.name}</h4>
                  <div className="bracket-slots">
                    <EmptySlots size={group.size} />
                  </div>
                </section>
              ))),
        ];
      })}
    </div>
  );
}

// Places for a bracket that is not drawn yet.
function EmptySlots({ size }: { size: number }) {
  return Array.from({ length: Math.ceil(size / 2) }, (_, i) => (
    <div key={i} className="bracket-match empty">
      <div className="bracket-team faint">–</div>
      {i < Math.floor(size / 2) && <div className="bracket-team faint">–</div>}
    </div>
  ));
}

function TeamLabel({ name, color }: { name: string; color: string }) {
  return (
    <span className="row start" style={{ gap: '0.5rem' }}>
      <TeamDot color={color} />
      {name}
    </span>
  );
}

interface MatchCardProps {
  match: BattleMatch;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
  waiting: boolean;
  screen: GameScreen | undefined; // where the game has it, if it is on a screen
  screensKnown: boolean; // false: the caller did not pass the screens, so say less
  actions?: ReactNode;
}

function MatchCard({ match, teamName, teamColor, waiting, screen, screensKnown, actions }: MatchCardProps) {
  const done = match.status === 'done';
  // Sent to the game. The game plays a few at once; the rest wait for a free screen.
  const sent = match.status === 'queued';
  const live = sent && (screen !== undefined || !screensKnown);
  const side = (id: string, i: 0 | 1) => {
    const classes = ['bracket-team'];
    if (done) classes.push(match.winner === id ? 'won' : 'lost');
    return (
      <div className={classes.join(' ')}>
        <TeamLabel name={teamName(id)} color={teamColor(id)} />
        {done && match.hp && <span className="num faint">{Math.round(match.hp[i])} HP</span>}
      </div>
    );
  };

  let meta: ReactNode;
  if (done) {
    const how = match.decidedBy === 'hp' ? 'Won on HP at the time limit' : match.decidedBy === 'host' ? 'Decided by the host' : 'Knockout';
    meta = `${how}${match.time !== null && match.decidedBy !== 'host' ? ` · ${Math.round(match.time)} s` : ''}`;
  } else if (sent && screen) meta = <strong>{screen.playing ? `On screen ${screen.screen + 1}` : `Going on screen ${screen.screen + 1}`}</strong>;
  else if (sent) meta = screensKnown ? 'Waiting for a free screen' : 'On the game now';
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
