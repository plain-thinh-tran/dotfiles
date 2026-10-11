import { describe, expect, test } from 'bun:test';
import {
  QUESTION_PATIENCE_MS,
  decisionLine,
  deliverableQuestionCount,
  hasUndeliveredQuestion,
  isDeliverableQuestion,
  isLocked,
  isReadyToSubmit,
  threadPrompt,
  waitBlock,
} from './prompt';
import type { Run, Todo } from './types';

function finding(extra: Partial<Todo> = {}): Todo {
  return {
    id: 'F2',
    kind: 'finding',
    category: 'needs-you',
    title: 'Fallback to the primary address',
    question: 'Explanation',
    recommendation: null,
    options: [],
    positions: [],
    tradeoffs: [],
    caveats: [],
    evidence: [{ ref: 'src/mail.ts:42' }],
    links: [{ label: 'Pull request', url: 'https://github.com/o/r/pull/9' }],
    state: 'answered',
    answer: { optionId: null, text: 'Why fall back here?\nIt hides errors.', deferred: false, answeredAt: '2026-01-01T00:00:00.000Z', comment: true },
    submittedAt: null,
    pickedUpAt: null,
    resolution: null,
    ...extra,
  };
}

describe('finding comments', () => {
  test('a queued comment counts toward Submit and is not locked', () => {
    expect(isReadyToSubmit(finding())).toBe(true);
    expect(isLocked(finding())).toBe(false);
    expect(isLocked(finding({ state: 'commented' }))).toBe(true);
    expect(isLocked(finding({ state: 'understood' }))).toBe(false);
  });

  test('the wait line asks the agent to post the comment and resolve with its url', () => {
    expect(decisionLine(finding(), 'run-1')).toBe(
      '- F2 Fallback to the primary address: POST COMMENT at src/mail.ts:42 (https://github.com/o/r/pull/9): Why fall back here? It hides errors. After posting, run mc resolve run-1 F2 "<comment url>".',
    );
    const bare = finding({ links: [], evidence: [] });
    expect(decisionLine(bare, 'run-1')).toContain('POST COMMENT at the PR: Why fall back here?');
  });

  test('the wait block lists the comment among the picked todos', () => {
    const run = { runId: 'run-1', todos: [finding({ state: 'picked_up' })] } as unknown as Run;
    const block = waitBlock(run, [finding({ state: 'submitted' })]);
    expect(block).toContain('MISSION CONTROL DECISIONS run-1');
    expect(block).toContain('- F2 Fallback to the primary address: POST COMMENT at src/mail.ts:42');
  });
});

describe('trailing punctuation', () => {
  test('a period is only added when the text does not already end in . ! or ?', () => {
    const answer = (text: string) => ({ optionId: null, text, deferred: false, answeredAt: 'x', comment: true as const });
    expect(decisionLine(finding({ answer: answer('Should this fail closed?') }), 'r')).toContain('Should this fail closed? After posting');
    expect(decisionLine(finding({ answer: answer('Fail closed!') }), 'r')).toContain('Fail closed! After posting');
    expect(decisionLine(finding({ answer: answer('Fail closed') }), 'r')).toContain('Fail closed. After posting');
    expect(decisionLine(finding({ answer: answer('Done.') }), 'r')).toContain('Done. After posting');
  });
});

describe('deliverable questions', () => {
  const NOW = Date.parse('2026-01-01T00:10:00.000Z');
  const asked = (extra: object = {}, at = '2026-01-01T00:09:00.000Z'): Todo =>
    finding({ state: 'open', answer: null, conversation: [{ from: 'thinh', text: 'What is a demo domain?', at, pending: true, ...extra }] });

  test('a pending question becomes deliverable after the fallback failed or 75 seconds', () => {
    expect(isDeliverableQuestion(asked({}, '2026-01-01T00:09:30.000Z'), NOW)).toBe(false);
    expect(isDeliverableQuestion(asked({ fallbackFailed: true }, '2026-01-01T00:09:59.000Z'), NOW)).toBe(true);
    expect(isDeliverableQuestion(asked({}, new Date(NOW - QUESTION_PATIENCE_MS).toISOString()), NOW)).toBe(true);
  });

  test('answered, already submitted or no longer pending questions are not deliverable', () => {
    expect(isDeliverableQuestion(asked({ pending: false, fallbackFailed: true }), NOW)).toBe(false);
    expect(isDeliverableQuestion(asked({ fallbackFailed: true, submittedAt: '2026-01-01T00:09:50.000Z' }), NOW)).toBe(false);
    expect(deliverableQuestionCount([{ todos: [asked({ fallbackFailed: true }), asked()] } as unknown as Run], NOW)).toBe(1);
  });

  test('a submitted question is undelivered until mc wait marks it delivered, and prints once', () => {
    const submitted = asked({ fallbackFailed: true, submittedAt: '2026-01-01T00:09:50.000Z' });
    expect(hasUndeliveredQuestion(submitted)).toBe(true);
    const delivered = asked({ fallbackFailed: true, submittedAt: '2026-01-01T00:09:50.000Z', deliveredAt: '2026-01-01T00:09:51.000Z' });
    expect(hasUndeliveredQuestion(delivered)).toBe(false);
    const run = { runId: 'run-1', todos: [delivered] } as unknown as Run;
    const block = waitBlock(run, [], [submitted]);
    expect(block).toContain('- F2 Fallback to the primary address: QUESTION from Thinh (unanswered): What is a demo domain? Reply with mc reply run-1 F2 "<answer>".');
    expect(waitBlock(run, [], [])).not.toContain('QUESTION');
    expect(threadPrompt([run])).toContain('QUESTION from Thinh (unanswered)');
  });
});
