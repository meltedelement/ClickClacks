// The admin page's Next button: what it does in each phase. It moves the quiz
// one step: question → locked → reveal → next question, with a round title on
// the big screen before the first question of each round, and a battle break
// after the rounds the schedule marks (see shared/rounds.ts).
import type { AdminView } from '../shared/types.ts';
import { currentStage } from '../shared/tournament.ts';
import { breakAfter, startsRound, stagesAllowed } from '../shared/rounds.ts';

export interface Step {
  label: string;
  action: Record<string, unknown>;
}

export function nextStep({ state, tournament }: AdminView): Step | null {
  if (state.intro !== null) return { label: 'Start round', action: { type: 'setQuestion', index: state.intro } };
  const hasNext = state.questionIndex < state.questions.length - 1;
  const goTo = (index: number): Step =>
    startsRound(state.questions, index)
      ? { label: 'Show next round', action: { type: 'setIntro', index } }
      : { label: 'Next question', action: { type: 'setQuestion', index } };
  switch (state.phase) {
    case 'lobby':
      return state.questions.length ? { ...goTo(state.questionIndex), label: 'Start quiz' } : null;
    case 'question':
      return { label: 'Close answers', action: { type: 'setPhase', phase: 'locked' } };
    case 'locked':
      return { label: 'Reveal answer', action: { type: 'setPhase', phase: 'reveal' } };
    case 'reveal': {
      // A battle break after the rounds the schedule marks, until there is a champion.
      const battleLeft = state.teams.length >= 2 && !tournament?.champion;
      if (battleLeft && breakAfter(state, state.questionIndex)) return { label: 'Start battle break', action: { type: 'setPhase', phase: 'battle' } };
      return hasNext ? goTo(state.questionIndex + 1) : null;
    }
    case 'battle': {
      // A break plays the stages the schedule gives it; the break after the last round plays every stage that is left.
      const battle = tournament;
      const round = battle && currentStage(battle);
      if (!battle) return state.teams.length >= 2 ? { label: 'Draw the bracket', action: { type: 'battleCreate' } } : null;
      if (round?.status === 'playing') return null;
      if (round && !battle.champion && round.status === 'waiting' && round.index < stagesAllowed(state, state.questionIndex)) {
        return { label: `Start ${round.name.toLowerCase()}`, action: { type: 'battleStartRound' } };
      }
      return hasNext ? { ...goTo(state.questionIndex + 1), label: 'Back to the quiz' } : null;
    }
  }
}

// The Back button: hide the round title, or go to the previous question.
export function backStep({ state }: AdminView): Step | null {
  if (state.intro !== null) return { label: 'Back', action: { type: 'setIntro', index: null } };
  if (state.questionIndex <= 0 || state.phase === 'lobby') return null;
  return { label: 'Previous question', action: { type: 'setQuestion', index: state.questionIndex - 1 } };
}

// Why Next is empty, for the control bar.
export function idleReason({ state, tournament }: AdminView): string {
  if (state.phase === 'battle' && tournament && !tournament.champion && currentStage(tournament)?.status === 'playing') return 'Stage playing…';
  if (state.phase === 'lobby' && !state.questions.length) return 'No questions loaded';
  return 'End of the quiz';
}

// What the big screen shows now, in a few words, so the host knows without looking up.
export function screenLabel({ state, tournament }: AdminView): string {
  const round = tournament && currentStage(tournament);
  if (round?.status === 'playing') return 'Arena';
  if (state.intro !== null) return 'Round title';
  switch (state.phase) {
    case 'lobby':
      return 'Join screen';
    case 'question':
      return 'Question, answers open';
    case 'locked':
      return 'Question, answers closed';
    case 'reveal':
      return 'Answer and votes';
    case 'battle':
      return tournament?.champion ? 'Champion' : 'Bracket';
  }
}
