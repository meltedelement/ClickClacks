// Reading the tournament the tournament service reports (see
// ../../api/tournament.d.ts). Shared by the quiz server and the React pages.
import type { Tournament, TournamentMatch } from './types.ts';

export function currentStage(t: Pick<Tournament, 'stages'>) {
  return t.stages[t.stages.length - 1] ?? null;
}

export function stageMatches(t: Pick<Tournament, 'matches'>, stage: number): TournamentMatch[] {
  return t.matches.filter((match) => match.stage === stage);
}

// How many stages the tournament has: the planned ones, or more after a grand final reset.
export function stageCount(t: Pick<Tournament, 'stages' | 'plan'>): number {
  return Math.max(t.plan.length, t.stages.length);
}

// True while the match is on the game (on a screen or waiting for one).
export function isSent(match: TournamentMatch): boolean {
  return match.status === 'queued' || match.status === 'playing';
}
