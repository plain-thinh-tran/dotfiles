import type { Option, Run, Todo } from './types';

export const APPROVAL_OPTIONS: Option[] = [
  { id: 'approve', label: 'Approve' },
  { id: 'reject', label: 'Reject' },
];

export function optionsFor(todo: Todo): Option[] {
  if (todo.options.length > 0) return todo.options;
  return todo.kind === 'approval' ? APPROVAL_OPTIONS : [];
}

export function isReadyToSubmit(todo: Todo): boolean {
  return todo.state === 'answered';
}

export function isAwaitingPickup(todo: Todo): boolean {
  return todo.state === 'submitted';
}

export function isLocked(todo: Todo): boolean {
  return todo.state === 'submitted' || todo.state === 'picked_up' || todo.state === 'done';
}

export function chosenLabel(todo: Todo): string {
  const answer = todo.answer;
  if (answer === null) return 'answered';
  if (answer.deferred) return 'deferred';
  if (answer.optionId === null) return 'answered';
  return optionsFor(todo).find((option) => option.id === answer.optionId)?.label ?? answer.optionId;
}

function oneLine(text: string): string {
  return text.trim().replace(/\s*\n\s*/g, ' ');
}

export function decisionLine(todo: Todo, runId: string): string {
  const text = oneLine(todo.answer?.text ?? '');
  const note = text === '' ? 'none' : text;
  const head = `- ${todo.id} ${todo.title}:`;
  if (todo.answer?.question === true) {
    return `${head} QUESTION from Thinh: ${text}. Reply with mc reply ${runId} ${todo.id} "<answer>"; the decision stays open.`;
  }
  const pick = todo.answer?.preset === true ? ' (council pick)' : '';
  return `${head} ${chosenLabel(todo)}${pick}. Note: ${note}`;
}

function stillOpenLine(run: Run, excluded: ReadonlySet<string>): string {
  const ids = run.todos
    .filter((t) => (t.state === 'open' || t.state === 'answered') && !excluded.has(t.id))
    .map((t) => t.id);
  return `Still open: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
}

export function waitBlock(run: Run, picked: Todo[]): string {
  return [
    `MISSION CONTROL DECISIONS ${run.runId}`,
    ...picked.map((todo) => decisionLine(todo, run.runId)),
    stillOpenLine(run, new Set(picked.map((todo) => todo.id))),
    `Next: act on the decisions, run \`mc resolve ${run.runId} <todoId> "<what you did>"\` for each, then \`mc wait ${run.runId}\` again if anything is still open.`,
  ].join('\n');
}

function runSection(run: Run): string | null {
  const decided = run.todos.filter((t) => isReadyToSubmit(t) || isAwaitingPickup(t));
  if (decided.length === 0) return null;
  return [
    `Mission Control decisions for ${run.title} (run ${run.runId})`,
    ...decided.map((todo) => decisionLine(todo, run.runId)),
    stillOpenLine(run, new Set()),
  ].join('\n');
}

export function threadPrompt(runs: Run[]): string {
  const sections = runs.map(runSection).filter((section): section is string => section !== null);
  return sections.length > 0 ? sections.join('\n\n') : 'No Mission Control decisions yet.';
}
