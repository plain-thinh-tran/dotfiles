import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Agent, LiveState, Run, Session, Thread, Todo, TodoCategory } from './types';

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10000;
const CATEGORY_RANK: Record<TodoCategory, number> = { 'needs-you': 0, 'key-decision': 1 };

export type TodoInput = Pick<Todo, 'id' | 'title'> &
  Partial<Omit<Todo, 'id' | 'title' | 'state' | 'answer' | 'submittedAt' | 'pickedUpAt' | 'resolution'>>;

export type PushInput = {
  runId: string;
  skill: string;
  title: string;
  session?: Partial<Session>;
  agents?: Agent[];
  todos?: TodoInput[];
};

export function mcHome(): string {
  const configured = process.env.MC_HOME;
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.mission-control');
}

export function runsDir(): string {
  return join(mcHome(), 'runs');
}

export function ensureRunsDir(): void {
  mkdirSync(runsDir(), { recursive: true });
}

export function runPath(runId: string): string {
  return join(runsDir(), `${runId}.json`);
}

export function readRun(runId: string): Run | null {
  if (!SAFE_ID.test(runId)) return null;
  const path = runPath(runId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Run;
  } catch {
    return null;
  }
}

export function writeRun(run: Run): string {
  ensureRunsDir();
  const path = runPath(run.runId);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(run, null, 2));
  renameSync(tmp, path);
  return path;
}

export function listRuns(): Run[] {
  if (!existsSync(runsDir())) return [];
  return readdirSync(runsDir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRun(name.slice(0, -'.json'.length)))
    .filter((run): run is Run => run !== null);
}

function breakStaleLock(path: string): void {
  try {
    if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true });
  } catch {
    return;
  }
}

async function acquireLock(path: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      closeSync(openSync(path, 'wx'));
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for lock ${path}`);
      breakStaleLock(path);
      await Bun.sleep(LOCK_RETRY_MS);
    }
  }
}

export async function withRunLock<T>(runId: string, fn: () => T | Promise<T>): Promise<T> {
  ensureRunsDir();
  const path = `${runPath(runId)}.lock`;
  await acquireLock(path);
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}

export async function updateRun(runId: string, mutate: (run: Run) => void): Promise<Run | null> {
  return await withRunLock(runId, () => {
    const run = readRun(runId);
    if (run === null) return null;
    mutate(run);
    run.updatedAt = new Date().toISOString();
    writeRun(run);
    return run;
  });
}

export function pruneRuns(now: number = Date.now()): number {
  const stale = listRuns().filter(
    (run) => run.status === 'done' && now - new Date(run.updatedAt).getTime() > PRUNE_AFTER_MS,
  );
  stale.forEach((run) => unlinkSync(runPath(run.runId)));
  return stale.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') throw new Error(`${context}: missing string field "${key}"`);
  return value;
}

function parseAgent(raw: unknown, index: number): Agent {
  if (!isRecord(raw)) throw new Error(`agents[${index}]: expected an object`);
  const context = `agents[${index}]`;
  return {
    id: requireString(raw, 'id', context),
    name: requireString(raw, 'name', context),
    role: (raw.role ?? 'council') as Agent['role'],
    harness: (raw.harness ?? 'other') as Agent['harness'],
    model: typeof raw.model === 'string' ? raw.model : '',
  };
}

function parseTodoInput(raw: unknown, index: number): TodoInput {
  if (!isRecord(raw)) throw new Error(`todos[${index}]: expected an object`);
  const context = `todos[${index}]`;
  requireString(raw, 'id', context);
  requireString(raw, 'title', context);
  return raw as TodoInput;
}

export function parsePushInput(raw: unknown): PushInput {
  if (!isRecord(raw)) throw new Error('Input must be a JSON object');
  const runId = requireString(raw, 'runId', 'input');
  if (!SAFE_ID.test(runId)) throw new Error('runId may only contain letters, digits, ".", "_" and "-"');
  return {
    runId,
    skill: requireString(raw, 'skill', 'input'),
    title: requireString(raw, 'title', 'input'),
    session: isRecord(raw.session) ? (raw.session as Partial<Session>) : undefined,
    agents: Array.isArray(raw.agents) ? raw.agents.map(parseAgent) : undefined,
    todos: Array.isArray(raw.todos) ? raw.todos.map(parseTodoInput) : undefined,
  };
}

function presetAnswer(input: TodoInput, now: string): Todo['answer'] {
  const optionId = input.recommendation?.optionId;
  if (input.category !== 'key-decision' || optionId === undefined) return null;
  return { optionId, text: '', deferred: false, answeredAt: now, preset: true };
}

function toTodo(input: TodoInput, existing: Todo | undefined, now: string): Todo {
  const preset = existing === undefined ? presetAnswer(input, now) : null;
  return {
    id: input.id,
    kind: input.kind ?? 'decision',
    category: input.category ?? 'key-decision',
    title: input.title,
    question: input.question ?? '',
    recommendation: input.recommendation ?? null,
    options: input.options ?? [],
    positions: input.positions ?? [],
    tradeoffs: input.tradeoffs ?? [],
    caveats: input.caveats ?? [],
    evidence: input.evidence ?? [],
    links: input.links ?? [],
    state: existing?.state ?? (preset === null ? 'open' : 'answered'),
    answer: existing?.answer ?? preset,
    submittedAt: existing?.submittedAt ?? null,
    pickedUpAt: existing?.pickedUpAt ?? null,
    resolution: existing?.resolution ?? null,
  };
}

export function mergeRun(existing: Run | null, input: PushInput, fallbackSession: Session): Run {
  const now = new Date().toISOString();
  const existingTodos = existing?.todos ?? [];
  const existingById = new Map(existingTodos.map((todo) => [todo.id, todo]));
  const pushed = (input.todos ?? []).map((todo) => toTodo(todo, existingById.get(todo.id), now));
  const pushedIds = new Set(pushed.map((todo) => todo.id));
  const kept = existingTodos.filter((todo) => !pushedIds.has(todo.id));
  return {
    version: 1,
    runId: input.runId,
    skill: input.skill,
    title: input.title,
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    session: { ...(existing?.session ?? fallbackSession), ...input.session },
    agents: input.agents ?? existing?.agents ?? [],
    todos: [...pushed, ...kept],
    submissions: existing?.submissions ?? [],
  };
}

function mergeAgents(runs: Run[]): Agent[] {
  const byId = new Map<string, Agent>();
  runs.flatMap((run) => run.agents).forEach((agent) => {
    if (!byId.has(agent.id)) byId.set(agent.id, agent);
  });
  const agents = [...byId.values()];
  return [...agents.filter((a) => a.role === 'orchestrator'), ...agents.filter((a) => a.role !== 'orchestrator')];
}

function liveRank(live: LiveState): number {
  if (live === 'waiting_on_you') return 0;
  if (live === 'working') return 1;
  return 2;
}

function countTodos(runs: Run[], state: Todo['state']): number {
  return runs.reduce((sum, run) => sum + run.todos.filter((todo) => todo.state === state).length, 0);
}

function sortTodos(run: Run): Run {
  const todos = [...run.todos].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
  return { ...run, todos };
}

function toThread(sessionId: string, groupRuns: Run[], live: LiveState): Thread {
  const runs = groupRuns.map(sortTodos);
  const latest = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] as Run;
  return {
    sessionId,
    session: latest.session,
    live,
    agents: mergeAgents(runs),
    runs,
    openCount: countTodos(runs, 'open'),
    answeredCount: countTodos(runs, 'answered'),
    updatedAt: latest.updatedAt,
  };
}

export function groupRunsBySession(runs: Run[]): Map<string, Run[]> {
  const groups = new Map<string, Run[]>();
  runs.forEach((run) => {
    const id = run.session.conductorSessionId;
    groups.set(id, [...(groups.get(id) ?? []), run]);
  });
  return groups;
}

export function buildThreads(runs: Run[], live: ReadonlyMap<string, LiveState>, showDone: boolean): Thread[] {
  const threads = [...groupRunsBySession(runs)]
    .filter(([, group]) => showDone || group.some((run) => run.status !== 'done'))
    .map(([sessionId, group]) => toThread(sessionId, group, live.get(sessionId) ?? 'dead'));
  return threads.sort(
    (a, b) => liveRank(a.live) - liveRank(b.live) || b.updatedAt.localeCompare(a.updatedAt),
  );
}
