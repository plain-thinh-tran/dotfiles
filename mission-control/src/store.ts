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
import { isReadyToSubmit } from './prompt';
import type { Agent, LiveState, Run, Session, Thread, Todo, TodoCategory } from './types';

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10000;
const CATEGORY_RANK: Record<TodoCategory, number> = { 'needs-you': 0, 'key-decision': 1 };

export type TodoInput = Pick<Todo, 'id' | 'title'> &
  Partial<Omit<Todo, 'id' | 'title' | 'state' | 'answer' | 'submittedAt' | 'pickedUpAt' | 'resolution'>>;

export type ConductorNames = {
  workspaceName: string;
  userSetName: boolean;
  prTitle: string;
  branch: string;
  title: string;
};

export type LiveInfo = { state: LiveState; names: ConductorNames | null };

export type PushInput = {
  runId: string;
  skill: string;
  title: string;
  summary?: string;
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

export type StepEntry = { text: string; at: string; agent: string | null };
export type StepsFile = { current: StepEntry | null; history: StepEntry[] };

const STEP_HISTORY = 30;

export function stepsDir(): string {
  return join(mcHome(), 'steps');
}

export function ensureStepsDir(): void {
  mkdirSync(stepsDir(), { recursive: true });
}

export function stepPath(sessionId: string): string {
  if (!SAFE_ID.test(sessionId)) throw new Error('sessionId may only contain letters, digits, ".", "_" and "-"');
  return join(stepsDir(), `${sessionId}.json`);
}

function toStepEntry(raw: unknown): StepEntry | null {
  if (!isRecord(raw) || typeof raw.text !== 'string' || typeof raw.at !== 'string') return null;
  return { text: raw.text, at: raw.at, agent: typeof raw.agent === 'string' ? raw.agent : null };
}

function parseStepsFile(raw: unknown): StepsFile {
  if (!isRecord(raw)) return { current: null, history: [] };
  if ('current' in raw || 'history' in raw) {
    const history = Array.isArray(raw.history) ? raw.history.map(toStepEntry).filter((e): e is StepEntry => e !== null) : [];
    return { current: toStepEntry(raw.current), history };
  }
  return { current: toStepEntry(raw), history: [] };
}

function readStepsFile(path: string): StepsFile {
  try {
    return parseStepsFile(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { current: null, history: [] };
  }
}

function saveStepsFile(path: string, file: StepsFile): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(file));
  renameSync(tmp, path);
}

export async function writeStep(sessionId: string, text: string, agent: string | null): Promise<string> {
  ensureStepsDir();
  const path = stepPath(sessionId);
  return await withFileLock(`${path}.lock`, () => {
    const entry: StepEntry = { text, at: new Date().toISOString(), agent };
    const file = readStepsFile(path);
    saveStepsFile(path, { current: entry, history: [...file.history, entry].slice(-STEP_HISTORY) });
    return path;
  });
}

export async function clearStep(sessionId: string): Promise<void> {
  ensureStepsDir();
  const path = stepPath(sessionId);
  await withFileLock(`${path}.lock`, () => {
    if (!existsSync(path)) return;
    saveStepsFile(path, { current: null, history: readStepsFile(path).history });
  });
}

export function readSteps(): Map<string, StepsFile> {
  const steps = new Map<string, StepsFile>();
  if (!existsSync(stepsDir())) return steps;
  readdirSync(stepsDir())
    .filter((name) => name.endsWith('.json'))
    .forEach((name) => steps.set(name.slice(0, -'.json'.length), readStepsFile(join(stepsDir(), name))));
  return steps;
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

export async function withFileLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  ensureRunsDir();
  await acquireLock(path);
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}

export async function withRunLock<T>(runId: string, fn: () => T | Promise<T>): Promise<T> {
  return await withFileLock(`${runPath(runId)}.lock`, fn);
}

function archivedPath(): string {
  return join(mcHome(), 'archived.json');
}

export function readArchived(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(archivedPath(), 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeArchived(ids: ReadonlySet<string>): void {
  ensureRunsDir();
  const path = archivedPath();
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify([...ids], null, 2));
  renameSync(tmp, path);
}

export async function setArchived(sessionId: string, archived: boolean): Promise<void> {
  await withFileLock(`${archivedPath()}.lock`, () => {
    const ids = readArchived();
    if (archived) ids.add(sessionId);
    else ids.delete(sessionId);
    writeArchived(ids);
  });
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
  const archived = readArchived();
  const expired = [...groupRunsBySession(listRuns())].filter(
    ([sessionId, runs]) =>
      archived.has(sessionId) && runs.every((run) => now - new Date(run.updatedAt).getTime() > PRUNE_AFTER_MS),
  );
  expired.forEach(([, runs]) => runs.forEach((run) => unlinkSync(runPath(run.runId))));
  if (expired.length > 0) {
    expired.forEach(([sessionId]) => archived.delete(sessionId));
    writeArchived(archived);
  }
  return expired.length;
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
    summary: typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim() : undefined,
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
    diffs: input.diffs ?? [],
    links: input.links ?? [],
    state: existing?.state ?? (preset === null ? 'open' : 'answered'),
    answer: existing?.answer ?? preset,
    submittedAt: existing?.submittedAt ?? null,
    pickedUpAt: existing?.pickedUpAt ?? null,
    resolution: existing?.resolution ?? null,
    doneAt: existing?.doneAt,
    conversation: existing?.conversation,
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
    summary: input.summary ?? existing?.summary ?? '',
    status: pushed.length > 0 ? 'active' : (existing?.status ?? 'active'),
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

function countTodos(runs: Run[], matches: (todo: Todo) => boolean): number {
  return runs.reduce((sum, run) => sum + run.todos.filter(matches).length, 0);
}

function sortTodos(run: Run): Run {
  const todos = [...run.todos].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
  return { ...run, todos };
}

function displayNameOf(names: ConductorNames | null, fallback: string): string {
  if (names === null) return fallback;
  if (names.userSetName && names.workspaceName !== '') return names.workspaceName;
  if (names.prTitle !== '') return names.prTitle;
  if (names.branch !== '') return names.branch;
  return fallback;
}

function descriptionOf(names: ConductorNames | null, runs: Run[]): string {
  if (names !== null && names.title !== '') return names.title;
  const newestFirst = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = newestFirst.find((run) => run.status !== 'done');
  return (active ?? newestFirst[0])?.title ?? '';
}

function summaryOf(runs: Run[]): string {
  const newestFirst = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return newestFirst.find((run) => run.summary !== undefined && run.summary !== '')?.summary ?? '';
}

function toThread(sessionId: string, groupRuns: Run[], info: LiveInfo | undefined, archived: boolean, steps: StepsFile | undefined): Thread {
  const runs = groupRuns.map(sortTodos);
  const latest = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] as Run;
  const names = info?.names ?? null;
  return {
    sessionId,
    archived,
    session: latest.session,
    displayName: displayNameOf(names, latest.session.workspaceName),
    description: descriptionOf(names, runs),
    summary: summaryOf(runs),
    live: info?.state ?? 'dead',
    step: steps?.current ?? null,
    steps: steps?.history ?? [],
    agents: mergeAgents(runs),
    runs,
    openCount: countTodos(runs, (todo) => todo.state === 'open'),
    answeredCount: countTodos(runs, isReadyToSubmit),
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

export function buildThreads(
  runs: Run[],
  live: ReadonlyMap<string, LiveInfo>,
  archived: ReadonlySet<string>,
  showArchived: boolean,
  steps: ReadonlyMap<string, StepsFile>,
): Thread[] {
  const threads = [...groupRunsBySession(runs)]
    .filter(([sessionId]) => showArchived || !archived.has(sessionId))
    .map(([sessionId, group]) =>
      toThread(sessionId, group, live.get(sessionId), archived.has(sessionId), steps.get(sessionId)),
    );
  return threads.sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      liveRank(a.live) - liveRank(b.live) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}
