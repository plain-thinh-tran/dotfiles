import { describe, expect, test } from 'bun:test';
import { mergeRun } from './store';
import type { Position, Run, Session, Todo } from './types';

const SESSION: Session = {
  conductorSessionId: 's1',
  workspacePath: '/tmp/x',
  workspaceName: 'x',
  repo: 'r',
  branch: 'b',
  pr: null,
};

const pick = (agent: string, optionId: string): Position => ({ agent, stance: optionId, optionId, summary: optionId });

function push(positions: Position[], recommendationOption: string, existing: Run | null = null): Run {
  return mergeRun(
    existing,
    {
      runId: 'r1',
      skill: 'avengers',
      title: 'Run',
      todos: [
        {
          id: 'D1',
          title: 'Decide',
          category: 'key-decision',
          positions,
          recommendation: { by: 'opus', optionId: recommendationOption, summary: 'go' },
        },
      ],
    },
    SESSION,
  );
}

function first(run: Run): Todo {
  return run.todos[0] as Todo;
}

describe('key-decision guard', () => {
  test('a unanimous council that matches the recommendation stays a council pick', () => {
    const todo = first(push([pick('codex', 'a'), pick('grok', 'a'), pick('opus', 'a')], 'a'));
    expect(todo.category).toBe('key-decision');
    expect(todo.state).toBe('answered');
    expect(todo.answer?.preset).toBe(true);
  });

  test('a 3 way split pushed as key-decision lands as an open needs-you todo', () => {
    const todo = first(push([pick('codex', 'a'), pick('grok', 'b'), pick('opus', 'c')], 'a'));
    expect(todo.category).toBe('needs-you');
    expect(todo.state).toBe('open');
    expect(todo.answer).toBeNull();
  });

  test('a 2 to 1 split, a single position and a recommendation that differs from the council are not council picks', () => {
    expect(first(push([pick('codex', 'a'), pick('grok', 'a'), pick('opus', 'b')], 'a')).category).toBe('needs-you');
    expect(first(push([pick('codex', 'a')], 'a')).category).toBe('needs-you');
    expect(first(push([pick('codex', 'a'), pick('grok', 'a')], 'b')).category).toBe('needs-you');
  });

  test('a preset answer is dropped when a later push turns the todo into a split', () => {
    const agreed = push([pick('codex', 'a'), pick('grok', 'a')], 'a');
    const todo = first(push([pick('codex', 'a'), pick('grok', 'b')], 'a', agreed));
    expect(todo.category).toBe('needs-you');
    expect(todo.state).toBe('open');
    expect(todo.answer).toBeNull();
  });

  test('an answer Thinh gave himself is kept when the todo becomes a split', () => {
    const agreed = push([pick('codex', 'a'), pick('grok', 'a')], 'a');
    const mine = first(agreed);
    mine.answer = { optionId: 'b', text: '', deferred: false, answeredAt: '2026-01-01T00:00:00.000Z' };
    const todo = first(push([pick('codex', 'a'), pick('grok', 'b')], 'a', agreed));
    expect(todo.state).toBe('answered');
    expect(todo.answer?.optionId).toBe('b');
  });
});
