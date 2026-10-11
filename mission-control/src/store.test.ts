import { describe, expect, test } from 'bun:test';
import { buildThreads, mergeRun, parsePushInput } from './store';
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

describe('thread activity', () => {
  test('updatedAt is the latest of the runs, the steps and the Conductor session activity', () => {
    const run = push([pick('codex', 'a'), pick('grok', 'a')], 'a');
    run.updatedAt = '2026-10-10T08:00:00.000Z';
    const steps = new Map([
      [
        's1',
        {
          current: { text: 'now', at: '2026-10-10T09:00:00.000Z', agent: null },
          history: [{ text: 'now', at: '2026-10-10T10:00:00.000Z', agent: null }],
        },
      ],
    ]);
    const info = new Map([['s1', { state: 'idle' as const, names: null, activityAt: '2026-10-10T11:30:00.000Z' }]]);
    const [thread] = buildThreads([run], info, new Set(), false, steps, new Map());
    expect(thread?.updatedAt).toBe('2026-10-10T11:30:00.000Z');
    const [quiet] = buildThreads([run], new Map(), new Set(), false, new Map(), new Map());
    expect(quiet?.updatedAt).toBe('2026-10-10T08:00:00.000Z');
  });

  test('instantAsk is true only when the session polled within the last minute', () => {
    const run = push([pick('codex', 'a'), pick('grok', 'a')], 'a');
    const fresh = buildThreads([run], new Map(), new Set(), false, new Map(), new Map([['s1', Date.now() - 5000]]));
    const stale = buildThreads([run], new Map(), new Set(), false, new Map(), new Map([['s1', Date.now() - 120000]]));
    expect(fresh[0]?.instantAsk).toBe(true);
    expect(stale[0]?.instantAsk).toBe(false);
    expect(buildThreads([run], new Map(), new Set(), false, new Map(), new Map())[0]?.instantAsk).toBe(false);
  });
});

describe('threads from steps', () => {
  const current = { text: 'Scouting aggregate surfaces', at: '2026-10-10T09:00:00.000Z', agent: 'codex' };
  const stepsFile = (active: boolean) => ({
    current: active ? current : null,
    history: [
      { text: 'Reading the diff', at: '2026-10-10T08:50:00.000Z', agent: null },
      current,
    ],
  });
  const names = {
    workspaceName: 'Jesus message',
    userSetName: true,
    prTitle: '',
    branch: 'jesus-message',
    title: 'Conductor UI',
    workspacePath: '/w/belgrade-v2',
    directoryName: 'belgrade-v2',
    repoName: 'services',
  };

  test('a session with a current step and no runs gets a thread', () => {
    const info = new Map([['s9', { state: 'working' as const, names, activityAt: null }]]);
    const [thread] = buildThreads([], info, new Set(), false, new Map([['s9', stepsFile(true)]]), new Map());
    expect(thread?.sessionId).toBe('s9');
    expect(thread?.runs).toEqual([]);
    expect(thread?.displayName).toBe('Jesus message');
    expect(thread?.description).toBe('Conductor UI');
    expect(thread?.session.workspacePath).toBe('/w/belgrade-v2');
    expect(thread?.live).toBe('working');
    expect(thread?.openCount).toBe(0);
    expect(thread?.agents.map((agent) => agent.id)).toEqual(['opus', 'codex']);
    expect(thread?.updatedAt).toBe('2026-10-10T09:00:00.000Z');
  });

  test('without a Conductor row the session id is the name', () => {
    const [thread] = buildThreads([], new Map(), new Set(), false, new Map([['s9', stepsFile(true)]]), new Map());
    expect(thread?.displayName).toBe('s9');
    expect(thread?.session.workspacePath).toBe('');
  });

  test('the thread disappears when the current step is cleared, and archived ids hide it', () => {
    expect(buildThreads([], new Map(), new Set(), false, new Map([['s9', stepsFile(false)]]), new Map())).toEqual([]);
    expect(buildThreads([], new Map(), new Set(['s9']), false, new Map([['s9', stepsFile(true)]]), new Map())).toEqual([]);
    expect(buildThreads([], new Map(), new Set(['s9']), true, new Map([['s9', stepsFile(true)]]), new Map())).toHaveLength(1);
  });

  test('the first run for that session turns it into a normal thread with the same id', () => {
    const run = push([pick('codex', 'a'), pick('grok', 'a')], 'a');
    run.session.conductorSessionId = 's9';
    const threads = buildThreads([run], new Map(), new Set(), false, new Map([['s9', stepsFile(true)]]), new Map());
    expect(threads).toHaveLength(1);
    expect(threads[0]?.sessionId).toBe('s9');
    expect(threads[0]?.runs).toHaveLength(1);
  });
});

describe('findings', () => {
  function pushFinding(extra: Partial<Todo> = {}): Todo {
    const run = mergeRun(
      null,
      {
        runId: 'r1',
        skill: 'prod-ready-check',
        title: 'PR',
        todos: [
          {
            id: 'F1',
            title: 'Finding',
            kind: 'finding',
            category: 'key-decision',
            question: 'Plain explanation',
            options: [{ id: 'a', label: 'A' }],
            recommendation: { by: 'opus', optionId: 'a', summary: 'go' },
            positions: [pick('codex', 'a'), pick('grok', 'a')],
            severity: 'regression',
            verification: 'Reproduced on dev',
            draftComment: 'Draft',
            suggestedQuestions: ['Why?', 'What is a demo domain?'],
            ...extra,
          },
        ],
      },
      SESSION,
    );
    return first(run);
  }

  test('a finding is always an open needs-you todo with no options, recommendation or preset', () => {
    const todo = pushFinding();
    expect(todo.kind).toBe('finding');
    expect(todo.category).toBe('needs-you');
    expect(todo.state).toBe('open');
    expect(todo.answer).toBeNull();
    expect(todo.options).toEqual([]);
    expect(todo.recommendation).toBeNull();
  });

  test('the finding fields are kept and a re-push keeps the state Thinh gave it', () => {
    const todo = pushFinding();
    expect(todo.severity).toBe('regression');
    expect(todo.verification).toBe('Reproduced on dev');
    expect(todo.draftComment).toBe('Draft');
    expect(todo.suggestedQuestions).toEqual(['Why?', 'What is a demo domain?']);
    const run = mergeRun(null, { runId: 'r1', skill: 's', title: 't', todos: [{ id: 'F1', title: 'Finding', kind: 'finding' }] }, SESSION);
    first(run).state = 'understood';
    const again = mergeRun(run, { runId: 'r1', skill: 's', title: 't', todos: [{ id: 'F1', title: 'Finding', kind: 'finding', draftComment: 'New draft' }] }, SESSION);
    expect(first(again).state).toBe('understood');
    expect(first(again).draftComment).toBe('New draft');
  });
});

describe('run mode', () => {
  const todo = [{ id: 'T', title: 'T' }];
  const threadOf = (run: Run) => buildThreads([run], new Map(), new Set(), false, new Map(), new Map())[0];

  test('the mode defaults from the skill and an explicit mode and pr are kept across pushes', () => {
    const build = mergeRun(null, { runId: 'a', skill: 'avengers', title: 't', todos: todo }, SESSION);
    const review = mergeRun(null, { runId: 'b', skill: 'prod-ready-check', title: 't', todos: todo }, SESSION);
    expect(threadOf(build)?.mode).toBe('build');
    expect(threadOf(review)?.mode).toBe('review');
    const pr = { number: 9, url: 'https://github.com/o/r/pull/9', author: 'octo' };
    const self = mergeRun(null, { runId: 'c', skill: 'prod-ready-check', title: 't', mode: 'self-check', pr, todos: todo }, SESSION);
    const again = mergeRun(self, { runId: 'c', skill: 'prod-ready-check', title: 't', todos: todo }, SESSION);
    expect(threadOf(again)?.mode).toBe('self-check');
    expect(threadOf(again)?.pr).toEqual(pr);
  });

  test('the thread takes the mode of its newest run and push parsing validates mode and pr', () => {
    const older = mergeRun(null, { runId: 'a', skill: 'avengers', title: 't', todos: todo }, SESSION);
    older.updatedAt = '2026-01-01T00:00:00.000Z';
    const newer = mergeRun(null, { runId: 'b', skill: 'prod-ready-check', title: 't', mode: 'self-check', todos: todo }, SESSION);
    const [thread] = buildThreads([older, newer], new Map(), new Set(), false, new Map(), new Map());
    expect(thread?.mode).toBe('self-check');
    const parsed = parsePushInput({ runId: 'x', skill: 's', title: 't', mode: 'nonsense', pr: { number: 3, url: 'u', author: 'a' } });
    expect(parsed.mode).toBeUndefined();
    expect(parsed.pr).toEqual({ number: 3, url: 'u', author: 'a' });
  });
});
