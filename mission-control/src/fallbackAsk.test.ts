import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerFromNotes, answerQuestion, answerWithFallback, askPrompt, clampAnswer, notesPrompt, type AskChain } from './fallbackAsk';
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

describe('notes reviewer', () => {
  const NOTES = { question: QUESTION, kind: 'finding' as const, runTitle: 'PR #9 Fix it', workspacePath: '', contextDir: '/ws/.context/prod-ready-check/pr-9', prNumber: 9 };

  test('the prompt names the notes, the pr refs and the earlier conversation', () => {
    const asked = { ...QUESTION, conversation: [{ from: 'thinh' as const, text: 'First?', at: 'x' }, { from: 'agent' as const, text: 'Yes.', at: 'y' }, ...QUESTION.conversation] };
    const prompt = notesPrompt({ ...NOTES, question: asked });
    expect(prompt).toContain('Thinh is reviewing finding Q1 "Which workspace?" of PR #9 Fix it and asks: Is it read only?');
    expect(prompt).toContain('The review notes are in /ws/.context/prod-ready-check/pr-9: report.md (final report), mc.json (findings), debate/');
    expect(prompt).toContain('The PR head is git ref pr-9; read code only with git show pr-9:<path> or git show origin/<base>:<path>.');
    expect(prompt).toContain('at most three short sentences');
    expect(prompt).toContain('Conversation so far:\n- Thinh: First?\n- Agent: Yes.');
    expect(prompt).not.toContain('- Thinh: Is it read only?');
  });

  test('without a context dir the notes sentence is dropped and the rest stays', () => {
    const prompt = notesPrompt({ ...NOTES, contextDir: undefined, prNumber: undefined });
    expect(prompt).not.toContain('review notes');
    expect(prompt).toContain('You are a read-only reviewer answering a quick follow-up. Read code only with git show <ref>:<path>.');
    expect(prompt).not.toContain('Conversation so far');
  });

  test('runs read only with the tool allow list in the workspace and clamps to three sentences', async () => {
    const argsFile = join(dir, 'notes-args.txt');
    process.env.MC_FALLBACK_CMD = script('notes.sh', `printf '%s\\n' "$@" > ${argsFile}\necho "One. Two. Three. Four."`);
    const answer = await answerFromNotes({ ...NOTES, workspacePath: dir });
    expect(answer).toBe('One. Two. Three.');
    const args = readFileSync(argsFile, 'utf8').split('\n');
    expect(args.slice(0, 14)).toEqual([
      '-p', '--model', 'sonnet', '--tools', 'Read,Grep,Glob,Bash', '--allowedTools', 'Read', 'Grep', 'Glob',
      'Bash(git show:*)', 'Bash(git log:*)', 'Bash(cat:*)', 'Bash(jq:*)', '--no-session-persistence',
    ]);
    expect(args).not.toContain('--resume');
  });
});

describe('answerer chain', () => {
  const chain = (overrides: Partial<AskChain> = {}): AskChain => ({
    question: QUESTION,
    kind: 'finding',
    runTitle: 'PR #9',
    workspacePath: dir,
    sessionId: 'sess-1',
    hasSession: true,
    ...overrides,
  });
  const stub = (name: string, forkBody: string, notesBody: string) =>
    script(name, `case "$*" in *--resume*) ${forkBody} ;; *) ${notesBody} ;; esac`);
  const stages = async (input: AskChain, timeouts = {}) => {
    const seen: string[] = [];
    const answer = await answerQuestion(input, async (stage) => seen.push(stage), timeouts);
    return { answer, seen };
  };

  test('a session copy that answers ends the chain', async () => {
    process.env.MC_FALLBACK_CMD = stub('chain-a.sh', 'echo "From the copy."', 'echo "From the notes."');
    expect(await stages(chain())).toEqual({ answer: 'From the copy.', seen: ['session'] });
  });

  test('a failing session copy falls through to the notes reviewer', async () => {
    process.env.MC_FALLBACK_CMD = stub('chain-b.sh', 'exit 1', 'echo "From the notes."');
    expect(await stages(chain())).toEqual({ answer: 'From the notes.', seen: ['session', 'notes'] });
  });

  test('without a session row the chain starts at the notes reviewer', async () => {
    process.env.MC_FALLBACK_CMD = stub('chain-c.sh', 'echo "From the copy."', 'echo "From the notes."');
    expect(await stages(chain({ hasSession: false }))).toEqual({ answer: 'From the notes.', seen: ['notes'] });
  });

  test('both failing or timing out gives null', async () => {
    process.env.MC_FALLBACK_CMD = stub('chain-d.sh', 'exit 1', 'exit 2');
    expect(await stages(chain())).toEqual({ answer: null, seen: ['session', 'notes'] });
    process.env.MC_FALLBACK_CMD = stub('chain-e.sh', 'exec sleep 5', 'exec sleep 5');
    const started = Date.now();
    expect((await stages(chain(), { session: 200, notes: 200 })).answer).toBeNull();
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
