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
  return todo.state === 'submitted' || todo.state === 'picked_up' || todo.state === 'done' || todo.state === 'commented';
}

export function chosenLabel(todo: Todo): string {
  const answer = todo.answer;
  if (answer === null) return 'answered';
  if (answer.deferred) return 'deferred';
  if (answer.optionId === null) return 'answered';
  return optionsFor(todo).find((option) => option.id === answer.optionId)?.label ?? answer.optionId;
}

const MOD_PATIENCE_MS = 45000;
const SESSION_PATIENCE_MS = 75000;
const NOTES_PATIENCE_MS = 150000;

type Message = NonNullable<Todo['conversation']>[number];

export function questionPatienceMs(message: Message): number {
  if (message.answerer === 'notes') return NOTES_PATIENCE_MS;
  return message.answerer === 'session' ? SESSION_PATIENCE_MS : MOD_PATIENCE_MS;
}

export function isStaleQuestion(message: Message, now: number): boolean {
  return message.fallbackFailed === true || now - new Date(message.at).getTime() >= questionPatienceMs(message);
}

export function latestThinhMessage(todo: Todo): Message | undefined {
  return [...(todo.conversation ?? [])].reverse().find((message) => message.from === 'thinh');
}

export function pendingQuestion(todo: Todo): string | null {
  const latest = latestThinhMessage(todo);
  return latest?.pending === true ? latest.text : null;
}

export function isDeliverableQuestion(todo: Todo, now: number): boolean {
  const latest = latestThinhMessage(todo);
  if (latest === undefined || latest.pending !== true || latest.submittedAt !== undefined) return false;
  return isStaleQuestion(latest, now);
}

export function hasUndeliveredQuestion(todo: Todo): boolean {
  const latest = latestThinhMessage(todo);
  return latest?.pending === true && latest.submittedAt !== undefined && latest.deliveredAt === undefined;
}

export function deliverableQuestionCount(runs: Run[], now: number): number {
  return runs.reduce((sum, run) => sum + run.todos.filter((todo) => isDeliverableQuestion(todo, now)).length, 0);
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function oneLine(text: string): string {
  return text.trim().replace(/\s*\n\s*/g, ' ');
}

export function decisionLine(todo: Todo, runId: string): string {
  const text = oneLine(todo.answer?.text ?? '');
  const note = text === '' ? 'none' : text;
  const head = `- ${todo.id} ${todo.title}:`;
  if (todo.answer?.comment === true) {
    const link = todo.links[0]?.url;
    return `${head} POST COMMENT at ${todo.evidence[0]?.ref ?? 'the PR'}${link === undefined ? '' : ` (${link})`}: ${sentence(text)} After posting, run mc resolve ${runId} ${todo.id} "<comment url>".`;
  }
  if (todo.answer?.question === true) {
    return `${head} QUESTION from Thinh: ${sentence(text)} Reply with mc reply ${runId} ${todo.id} "<answer>"; the decision stays open.`;
  }
  const pick = todo.answer?.preset === true ? ' (council pick)' : '';
  return `${head} ${chosenLabel(todo)}${pick}. Note: ${note}`;
}

function pendingLine(todo: Todo, runId: string): string | null {
  const text = pendingQuestion(todo);
  if (text === null) return null;
  return `- ${todo.id} ${todo.title}: QUESTION from Thinh (unanswered): ${sentence(oneLine(text))} Reply with mc reply ${runId} ${todo.id} "<answer>".`;
}

function pendingLines(run: Run): string[] {
  return run.todos.flatMap((todo) => pendingLine(todo, run.runId) ?? []);
}

function stillOpenLine(run: Run, excluded: ReadonlySet<string>): string {
  const ids = run.todos
    .filter((t) => (t.state === 'open' || t.state === 'answered') && !excluded.has(t.id))
    .map((t) => t.id);
  return `Still open: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
}

export function waitBlock(run: Run, picked: Todo[], questions: Todo[] = []): string {
  return [
    `MISSION CONTROL DECISIONS ${run.runId}`,
    ...picked.map((todo) => decisionLine(todo, run.runId)),
    ...questions.flatMap((todo) => pendingLine(todo, run.runId) ?? []),
    stillOpenLine(run, new Set(picked.map((todo) => todo.id))),
    `Next: act on the decisions, run \`mc resolve ${run.runId} <todoId> "<what you did>"\` for each, then \`mc wait ${run.runId}\` again if anything is still open.`,
  ].join('\n');
}

function runSection(run: Run): string | null {
  const decided = run.todos.filter((t) => isReadyToSubmit(t) || isAwaitingPickup(t));
  const pending = pendingLines(run);
  if (decided.length === 0 && pending.length === 0) return null;
  return [
    `Mission Control decisions for ${run.title} (run ${run.runId})`,
    ...decided.map((todo) => decisionLine(todo, run.runId)),
    ...pending,
    stillOpenLine(run, new Set()),
  ].join('\n');
}

export function threadPrompt(runs: Run[]): string {
  const sections = runs.map(runSection).filter((section): section is string => section !== null);
  return sections.length > 0 ? sections.join('\n\n') : 'No Mission Control decisions yet.';
}
