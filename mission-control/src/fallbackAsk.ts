import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WorkQuestion } from './questions';

const MAX_SENTENCES = 2;
const MAX_WORDS = 60;
const FALLBACK_TIMEOUT_MS = 60000;

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

export function clampAnswer(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = flat.split(/(?<=[.!?])\s+/).slice(0, MAX_SENTENCES).join(' ');
  const words = sentences.split(' ');
  return words.length <= MAX_WORDS ? sentences : `${words.slice(0, MAX_WORDS).join(' ')}…`;
}

function command(): string {
  return process.env.MC_FALLBACK_CMD ?? join(homedir(), '.local/bin/claude');
}

export async function answerWithFallback(
  question: WorkQuestion,
  sessionId: string,
  workspacePath: string,
  timeoutMs: number = FALLBACK_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      [
        command(),
        '-p',
        '--resume',
        sessionId,
        '--fork-session',
        '--no-session-persistence',
        '--tools',
        '',
        '--model',
        'sonnet',
        askPrompt(question),
      ],
      { cwd: workspacePath, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
    );
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const output = await new Response(proc.stdout).text();
      if ((await proc.exited) !== 0) return null;
      const answer = clampAnswer(output);
      return answer === '' ? null : answer;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('Fallback ask failed', { err, sessionId });
    return null;
  }
}
