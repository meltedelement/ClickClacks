// The tournament: one column per stage. In a double elimination the winners
// bracket is the top row and the losers bracket under it, and the grand final
// spans both rows; other formats have one group per stage. Stages (and groups)
// that are not drawn yet show as empty slots. Used by the admin page (with
// buttons per match). A round robin also shows its table.
import type { ReactNode } from 'react';
import type { Tournament, TournamentMatch } from '../shared/types.ts';
import { isSent, stageCount, stageMatches } from '../shared/tournament.ts';
import { TeamDot } from './ui.tsx';

interface BracketProps {
  battle: Tournament;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
  actions?: (match: TournamentMatch) => ReactNode; // admin buttons under a match
  screensKnown?: boolean; // false: the display's screens are not known, so say less
}

// The grid row of each group: the losers bracket goes under the rest.
const ROW: Record<string, string> = { losers: '3', final: '2 / span 2' };
const row = (side: string) => ROW[side] ?? '2';

export function Bracket({ battle, teamName, teamColor, actions, screensKnown = true }: BracketProps) {
  const planned = battle.plan;
  const stages = stageCount(battle);
  const current = battle.stages.length - 1;

  return (
    <div className="bracket" style={{ gridTemplateColumns: `repeat(${stages}, minmax(13.125rem, 1fr))` }}>
      {Array.from({ length: stages }, (_, index) => {
        const round = battle.stages[index];
        const live = index === current && !battle.champion;
        const column = String(index + 1);
        return [
          <h3 key={`h${index}`} className={live ? 'eyebrow bracket-head current' : 'eyebrow bracket-head'} style={{ gridColumn: column, gridRow: '1' }}>
            Stage {index + 1}
            {round && live && <span className="bracket-state"> · {round.status === 'playing' ? 'playing' : round.status === 'waiting' ? 'waiting for the host' : 'done'}</span>}
          </h3>,
          ...(round
            ? round.groups.map((group) => (
                <section key={`${index}${group.side}`} className={`bracket-group ${group.side}`} style={{ gridColumn: column, gridRow: row(group.side) }}>
                  <h4 className="bracket-group-name">{group.name}</h4>
                  {group.pending ? (
                    <div className="bracket-slots">
                      <EmptySlots size={planned[index]?.find((g) => g.side === group.side)?.size ?? group.entrants.length} />
                      <div className="bracket-meta">Drawn when the winners bracket is finished</div>
                    </div>
                  ) : (
                    <div className="bracket-slots">
                      {stageMatches(battle, index)
                        .filter((match) => match.side === group.side)
                        .map((match) => (
                          <MatchCard
                            key={match.id}
                            match={match}
                            teamName={teamName}
                            teamColor={teamColor}
                            waiting={round.status === 'waiting'}
                            screensKnown={screensKnown}
                            actions={actions?.(match)}
                          />
                        ))}
                      {group.bye && (
                        <div className="bracket-match bye">
                          <div className="bracket-team">
                            <TeamLabel name={teamName(group.bye)} color={teamColor(group.bye)} />
                          </div>
                          <div className="bracket-meta">{group.entrants.length === 1 ? 'Waits for the other bracket' : 'Bye: no match this stage'}</div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ))
            : (planned[index] ?? []).map((group) => (
                <section key={`${index}${group.side}`} className={`bracket-group ${group.side}`} style={{ gridColumn: column, gridRow: row(group.side) }}>
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
  match: TournamentMatch;
  teamName: (id: string) => string;
  teamColor: (id: string) => string;
  waiting: boolean;
  screensKnown: boolean; // false: the display's screens are not known, so say less
  actions?: ReactNode;
}

function MatchCard({ match, teamName, teamColor, waiting, screensKnown, actions }: MatchCardProps) {
  const done = match.status === 'done';
  // Sent to the game. The game plays a few at once; the rest wait for a free screen.
  const sent = isSent(match);
  const screen = match.screen;
  const live = sent && (screen !== null || !screensKnown);
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
  } else if (sent && screen !== null) meta = <strong>{match.status === 'playing' ? `On screen ${screen + 1}` : `Going on screen ${screen + 1}`}</strong>;
  else if (sent) meta = screensKnown ? 'Waiting for a free screen' : 'On the game now';
  else if (match.status === 'pending') meta = waiting ? 'Up next' : 'Waiting for a display';
  else meta = <span className="error">{match.error ?? match.status}</span>;

  return (
    <div className={live ? 'bracket-match live' : 'bracket-match'}>
      {side(match.entrants[0], 0)}
      {side(match.entrants[1], 1)}
      <div className="bracket-meta">
        <span className="faint num">{match.id}</span> {meta}
      </div>
      {actions && <div className="bracket-actions">{actions}</div>}
    </div>
  );
}

// A round robin's table: points, wins and losses, best first.
export function Standings({ battle, teamName, teamColor }: Pick<BracketProps, 'battle' | 'teamName' | 'teamColor'>) {
  return (
    <table className="standings">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Team</th>
          <th className="num">Won</th>
          <th className="num">Lost</th>
          <th className="num">Points</th>
        </tr>
      </thead>
      <tbody>
        {battle.standings.map((row) => (
          <tr key={row.entrant} className={battle.champion === row.entrant ? 'won' : ''}>
            <td className="num">{row.rank}</td>
            <td>
              <TeamLabel name={teamName(row.entrant)} color={teamColor(row.entrant)} />
            </td>
            <td className="num">{row.wins}</td>
            <td className="num">{row.losses}</td>
            <td className="num">{row.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
