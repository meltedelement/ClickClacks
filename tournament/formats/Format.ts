// What every tournament format provides. The store and the runner only talk to
// formats through this, so a new format is one file plus a line in index.ts.
//
// A tournament is played in stages. The last stage in `stages` is the current
// one. A stage is drawn (its groups and matches exist) before it starts; the
// caller starts it, its matches go to the game, and once every match has a
// winner `advance` draws the next stage or names the champion. A format may
// hold part of a stage back (a `pending` group) until results earlier in the
// same stage are known, and draw it in `update` (the double elimination's
// losers bracket).
//
// Formats are pure: they change the state they are given and never do I/O.
// Every random choice comes from the tournament seed, so a tournament drawn
// again from the same seed and entrants is the same tournament.
import type { EntrantProgress, FormatId, FormatInfo, FormatOptions, PlannedGroup, Stage, Standing, TournamentMatch } from '../../contracts/tournament.d.ts';

// The part of a tournament a format reads and changes.
export interface FormatState {
  seed: number;
  options: Required<FormatOptions>;
  entrants: { id: string }[];
  stages: Stage[];
  matches: TournamentMatch[];
  champion: string | null;
}

export interface Format extends FormatInfo {
  id: FormatId;
  // The first stage. `entrants` are ids, two or more, in the order given.
  create(entrants: string[], seed: number, options: Required<FormatOptions>): { stages: Stage[]; matches: TournamentMatch[] };
  // Draws what can be drawn now inside the current stage. Changes `t` and returns the new matches.
  update(t: FormatState): TournamentMatch[];
  // Matches of the current stage drawn from this match's result: they must not
  // have started for the match to be replayed or decided again.
  dependents(t: FormatState, match: TournamentMatch): TournamentMatch[];
  // Takes back what was drawn from this match's result, before it is replayed or decided again.
  undo(t: FormatState, match: TournamentMatch): void;
  // After a complete stage: the next stage, or the champion.
  advance(t: FormatState): { champion: string } | { stage: Stage; matches: TournamentMatch[] };
  progress(t: FormatState, entrant: string): EntrantProgress;
  standings(t: FormatState): Standing[];
}
