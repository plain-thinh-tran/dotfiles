import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerWithFallback, askPrompt, clampAnswer } from './fallbackAsk';
import type { WorkQuestion } from './questions';
import { recentlyPolled } from './store';

const QUESTION: WorkQuestion = {
  runId: 'r1',
  todoId: 'Q1',
  title: 'Which workspace?',
  question: 'Pick one.',
  text: 'Is it read only?',
  recommendation: { by: 'opus', optionId: 'a', summary: 'go' },
  options: [{ id: 'a', label: 'prod' }],
  positions: [{ agent: 'codex', optionId: 'a', summary: 'prod' }],
  tradeoffs: [],
  caveats: [],
  conversation: [{ from: 'thinh', text: 'Is it read only?', at: '2026-01-01T00:00:00.000Z', pending: true }],
};

let dir = '';
let previous: string | undefined;

function script(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-fallback-'));
  previous = process.env.MC_FALLBACK_CMD;
});

afterAll(() => {
  if (previous === undefined) delete process.env.MC_FALLBACK_CMD;
  else process.env.MC_FALLBACK_CMD = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe('answerWithFallback', () => {
  test('runs the command in the workspace with the fork flags and clamps the output', async () => {
    const argsFile = join(dir, 'args.txt');
    process.env.MC_FALLBACK_CMD = script(
      'ok.sh',
      `printf '%s\\n' "$@" > ${argsFile}\npwd > ${argsFile}.cwd\necho "Yes, it only reads. That is safe. This third sentence is dropped."`,
    );
    const answer = await answerWithFallback(QUESTION, 'sess-1', dir);
    expect(answer).toBe('Yes, it only reads. That is safe.');
    const args = readFileSync(argsFile, 'utf8').split('\n');
    expect(args.slice(0, 9)).toEqual(['-p', '--resume', 'sess-1', '--fork-session', '--no-session-persistence', '--tools', '', '--model', 'sonnet']);
    expect(args[9]).toContain('asks: Is it read only?');
    expect(readFileSync(`${argsFile}.cwd`, 'utf8').trim().endsWith(dir.split('/').pop() as string)).toBe(true);
  });

  test('returns null when the command fails or prints nothing', async () => {
    process.env.MC_FALLBACK_CMD = script('fail.sh', 'echo "nope"\nexit 3');
    expect(await answerWithFallback(QUESTION, 'sess-1', dir)).toBeNull();
    process.env.MC_FALLBACK_CMD = script('empty.sh', 'exit 0');
    expect(await answerWithFallback(QUESTION, 'sess-1', dir)).toBeNull();
  });

  test('returns null when the command times out', async () => {
    process.env.MC_FALLBACK_CMD = script('slow.sh', 'exec sleep 5');
    const started = Date.now();
    expect(await answerWithFallback(QUESTION, 'sess-1', dir, 200)).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('returns null when the workspace does not exist', async () => {
    process.env.MC_FALLBACK_CMD = script('ok2.sh', 'echo "Fine."');
    expect(await answerWithFallback(QUESTION, 'sess-1', join(dir, 'missing'))).toBeNull();
  });
});

describe('askPrompt and clampAnswer', () => {
  test('the prompt carries the title, the question and the decision context', () => {
    const prompt = askPrompt(QUESTION);
    expect(prompt).toContain('decision Q1 "Which workspace?"');
    expect(prompt).toContain('under 40 words');
    expect(prompt).toContain('Decision context: {"decision":"Pick one."');
  });

  test('keeps two sentences and at most 60 words', () => {
    expect(clampAnswer('One. Two! Three?')).toBe('One. Two!');
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
    const clamped = clampAnswer(long);
    expect(clamped.split(' ')).toHaveLength(60);
    expect(clamped.endsWith('…')).toBe(true);
  });
});

describe('recentlyPolled', () => {
  test('only a poll within the last 60 seconds counts', () => {
    expect(recentlyPolled(undefined, 100000)).toBe(false);
    expect(recentlyPolled(100000 - 59000, 100000)).toBe(true);
    expect(recentlyPolled(100000 - 61000, 100000)).toBe(false);
  });
});
