import type { Option, Run, Todo } from './types';

export const APPROVAL_OPTIONS: Option[] = [
  { id: 'approve', label: 'Approve' },
  { id: 'reject', label: 'Reject' },
];

export function optionsFor(todo: Todo): Option[] {
  if (todo.options.length > 0) return todo.options;
  return todo.kind === 'approval' ? APPROVAL_OPTIONS : [];
}

export function chosenLabel(todo: Todo): string {
  const answer = todo.answer;
  if (answer === null) return 'answered';
  if (answer.deferred) return 'deferred';
  if (answer.optionId === null) return 'answered';
  return optionsFor(todo).find((option) => option.id === answer.optionId)?.label ?? answer.optionId;
}

export function decisionLine(todo: Todo): string {
  const text = todo.answer?.text.trim() ?? '';
  const note = text === '' ? 'none' : text.replace(/\s*\n\s*/g, ' ');
  const pick = todo.answer?.preset === true ? ' (council pick)' : '';
  return `- ${todo.id} ${todo.title}: ${chosenLabel(todo)}${pick}. Note: ${note}`;
}

function stillOpenLine(run: Run): string {
  const ids = run.todos.filter((t) => t.state === 'open' || t.state === 'answered').map((t) => t.id);
  return `Still open: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
}

export function waitBlock(run: Run, picked: Todo[]): string {
  return [
    `MISSION CONTROL DECISIONS ${run.runId}`,
    ...picked.map(decisionLine),
    stillOpenLine(run),
    `Next: act on the decisions, run \`mc resolve ${run.runId} <todoId> "<what you did>"\` for each, then \`mc wait ${run.runId}\` again if anything is still open.`,
  ].join('\n');
}

function runSection(run: Run): string | null {
  const decided = run.todos.filter((t) => t.state === 'answered' || t.state === 'submitted');
  if (decided.length === 0) return null;
  return [
    `Mission Control decisions for ${run.title} (run ${run.runId})`,
    ...decided.map(decisionLine),
    stillOpenLine(run),
  ].join('\n');
}

export function threadPrompt(runs: Run[]): string {
  const sections = runs.map(runSection).filter((section): section is string => section !== null);
  return sections.length > 0 ? sections.join('\n\n') : 'No Mission Control decisions yet.';
}
