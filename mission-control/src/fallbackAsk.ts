import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WorkQuestion } from './questions';
import type { TodoKind } from './types';

const MAX_SENTENCES = 2;
const MAX_WORDS = 60;
const MAX_NOTES_SENTENCES = 3;
const MAX_NOTES_WORDS = 90;
const FALLBACK_TIMEOUT_MS = 60000;
const NOTES_TIMEOUT_MS = 120000;
const NOTES_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(cat:*)', 'Bash(jq:*)'];

export function askPrompt(question: WorkQuestion): string {
  const context = {
    decision: question.question,
    recommendation: question.recommendation,
    options: question.options,
    positions: question.positions,
    tradeoffs: question.tradeoffs,
    caveats: question.caveats,
    conversation: question.conversation,
  };
  return [
    `Thinh is reviewing decision ${question.todoId} "${question.title}" in Mission Control and asks: ${question.text}`,
    '',
    'Answer like a teammate on chat: at most two short sentences, under 40 words in total. Lead with the answer. No preamble, no restating the question, no lists, no headings, no markdown.',
    'Use what you already know from this session and stay consistent with what you said before. If it needs investigation, say in one sentence what you would check.',
    '',
    `Decision context: ${JSON.stringify(context)}`,
  ].join('\n');
}

export function clampAnswer(text: string, maxSentences: number = MAX_SENTENCES, maxWords: number = MAX_WORDS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = flat.split(/(?<=[.!?])\s+/).slice(0, maxSentences).join(' ');
  const words = sentences.split(' ');
  return words.length <= maxWords ? sentences : `${words.slice(0, maxWords).join(' ')}…`;
}

function command(): string {
  return process.env.MC_FALLBACK_CMD ?? join(homedir(), '.local/bin/claude');
}

async function runClaude(args: string[], cwd: string, timeoutMs: number, clamp: (text: string) => string): Promise<string | null> {
  try {
    const proc = Bun.spawn([command(), ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const output = await new Response(proc.stdout).text();
      if ((await proc.exited) !== 0) return null;
      const answer = clamp(output);
      return answer === '' ? null : answer;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('Fallback ask failed', { err, cwd });
    return null;
  }
}

export async function answerWithFallback(
  question: WorkQuestion,
  sessionId: string,
  workspacePath: string,
  timeoutMs: number = FALLBACK_TIMEOUT_MS,
): Promise<string | null> {
  const args = ['-p', '--resume', sessionId, '--fork-session', '--no-session-persistence', '--tools', '', '--model', 'sonnet', askPrompt(question)];
  return await runClaude(args, workspacePath, timeoutMs, clampAnswer);
}

export type NotesAsk = {
  question: WorkQuestion;
  kind: TodoKind;
  runTitle: string;
  workspacePath: string;
  contextDir?: string;
  prNumber?: number;
};

function conversationSoFar(question: WorkQuestion): string[] {
  const earlier = question.conversation.filter((message) => !(message.pending === true && message.text === question.text));
  if (earlier.length === 0) return [];
  return ['', 'Conversation so far:', ...earlier.map((message) => `- ${message.from === 'thinh' ? 'Thinh' : 'Agent'}: ${message.text}`)];
}

export function notesPrompt(input: NotesAsk): string {
  const { question } = input;
  const notes =
    input.contextDir === undefined
      ? ''
      : `The review notes are in ${input.contextDir}: report.md (final report), mc.json (findings), debate/ (what each reviewer said), diff.patch, external/ (related PRs in other repos). `;
  const code =
    input.prNumber === undefined
      ? 'Read code only with git show <ref>:<path>. '
      : `The PR head is git ref pr-${input.prNumber}; read code only with git show pr-${input.prNumber}:<path> or git show origin/<base>:<path>. `;
  return [
    `Thinh is reviewing ${input.kind === 'finding' ? 'finding' : 'decision'} ${question.todoId} "${question.title}" of ${input.runTitle} and asks: ${question.text}`,
    '',
    `You are a read-only reviewer answering a quick follow-up. ${notes}${code}Look things up if needed, but answer in at most three short sentences, plain words, lead with the answer, no headings or lists.`,
    ...conversationSoFar(question),
  ].join('\n');
}

export async function answerFromNotes(input: NotesAsk, timeoutMs: number = NOTES_TIMEOUT_MS): Promise<string | null> {
  const args = ['-p', '--model', 'sonnet', '--tools', 'Read,Grep,Glob,Bash', '--allowedTools', ...NOTES_TOOLS, '--no-session-persistence', notesPrompt(input)];
  return await runClaude(args, input.workspacePath, timeoutMs, (text) => clampAnswer(text, MAX_NOTES_SENTENCES, MAX_NOTES_WORDS));
}

export type AnswerStage = 'session' | 'notes';

export type AskChain = NotesAsk & { sessionId: string; hasSession: boolean };

export async function answerQuestion(
  input: AskChain,
  onStage: (stage: AnswerStage) => Promise<unknown>,
  timeouts: { session?: number; notes?: number } = {},
): Promise<string | null> {
  if (input.hasSession) {
    await onStage('session');
    const forked = await answerWithFallback(input.question, input.sessionId, input.workspacePath, timeouts.session);
    if (forked !== null) return forked;
  }
  await onStage('notes');
  return await answerFromNotes(input, timeouts.notes);
}
