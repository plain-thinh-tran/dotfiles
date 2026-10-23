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
import { councilAgrees } from './council';
import { isRunMode, modeOf } from './mode';
import { isReadyToSubmit, latestThinhMessage } from './prompt';
import { GROUP_ORDER, threadGroup } from './threadGroups';
import type { Agent, LiveState, Position, Run, RunMode, RunPr, Session, Thread, Todo, TodoCategory } from './types';

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
  workspacePath: string;
  directoryName: string;
  repoName: string;
};

export type LiveInfo = { state: LiveState; names: ConductorNames | null; activityAt: string | null };

export type PushInput = {
  runId: string;
  skill: string;
  title: string;
  summary?: string;
  overview?: string;
  mode?: RunMode;
  pr?: RunPr;
  contextDir?: string;
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
    return normalizeRun(JSON.parse(readFileSync(path, 'utf8')) as Run);
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

function namesPath(): string {
  return join(mcHome(), 'names.json');
}

export function readNames(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(namesPath(), 'utf8'));
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function syncPath(): string {
  return join(mcHome(), 'sync.json');
}

export function readSyncs(): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(syncPath(), 'utf8'));
    if (!isRecord(parsed)) return new Map();
    return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return new Map();
  }
}

export async function setSync(sessionId: string, requestedAt: string | null): Promise<void> {
  await withFileLock(`${syncPath()}.lock`, () => {
    const syncs = readSyncs();
    if (requestedAt === null) syncs.delete(sessionId);
    else syncs.set(sessionId, requestedAt);
    const path = syncPath();
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(syncs), null, 2));
    renameSync(tmp, path);
  });
}

export async function setName(sessionId: string, name: string | null): Promise<void> {
  await withFileLock(`${namesPath()}.lock`, () => {
    const names = readNames();
    const trimmed = name?.trim() ?? '';
    if (trimmed === '') delete names[sessionId];
    else names[sessionId] = trimmed;
    ensureRunsDir();
    const tmp = `${namesPath()}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(names, null, 2));
    renameSync(tmp, namesPath());
  });
}

async function changeTodo(runId: string, todoId: string, change: (todo: Todo, at: string) => void): Promise<boolean> {
  let found = false;
  await updateRun(runId, (run) => {
    const todo = run.todos.find((t) => t.id === todoId);
    if (todo === undefined) return;
    found = true;
    change(todo, new Date().toISOString());
  });
  return found;
}

type Message = NonNullable<Todo['conversation']>[number];

export function patchLatestThinh(todo: Todo, patch: Partial<Message>): void {
  const conversation = todo.conversation ?? [];
  const index = conversation.map((message) => message.from).lastIndexOf('thinh');
  if (index === -1) return;
  todo.conversation = conversation.map((message, i) => (i === index ? { ...message, ...patch } : message));
}

export function withoutSubmission(todo: Todo): void {
  const conversation = todo.conversation ?? [];
  const index = conversation.map((message) => message.from).lastIndexOf('thinh');
  const message = conversation[index];
  if (message === undefined) return;
  const rest = { ...message };
  delete rest.submittedAt;
  todo.conversation = conversation.map((candidate, i) => (i === index ? rest : candidate));
}

export async function markFallbackFailed(runId: string, todoId: string, text: string): Promise<boolean> {
  return await changeTodo(runId, todoId, (todo) => {
    const latest = [...(todo.conversation ?? [])].reverse().find((message) => message.from === 'thinh');
    if (latest?.pending === true && latest.text === text) patchLatestThinh(todo, { fallbackFailed: true });
  });
}

export async function markAnswerer(runId: string, todoId: string, text: string, answerer: 'session' | 'notes'): Promise<boolean> {
  return await changeTodo(runId, todoId, (todo) => {
    const latest = latestThinhMessage(todo);
    if (latest?.pending === true && latest.text === text) patchLatestThinh(todo, { answerer });
  });
}

export async function restartQuestion(runId: string, todoId: string): Promise<boolean> {
  return await changeTodo(runId, todoId, (todo, at) => {
    const latest = latestThinhMessage(todo);
    if (latest?.pending !== true || latest.submittedAt !== undefined) return;
    const { fallbackFailed: _failed, answerer: _answerer, ...rest } = latest;
    todo.conversation = (todo.conversation ?? []).map((message) => (message === latest ? { ...rest, at } : message));
  });
}

export async function addQuestion(runId: string, todoId: string, text: string): Promise<boolean> {
  return await changeTodo(runId, todoId, (todo, at) => {
    todo.conversation = [...(todo.conversation ?? []), { from: 'thinh', text, at, pending: true }];
  });
}

export async function addReply(runId: string, todoId: string, text: string, newQuestion?: string): Promise<boolean> {
  return await changeTodo(runId, todoId, (todo, at) => {
    const settled = (todo.conversation ?? []).map((message) =>
      message.from === 'thinh' ? { from: message.from, text: message.text, at: message.at } : message,
    );
    todo.conversation = [...settled, { from: 'agent', text, at }];
    if (newQuestion !== undefined) todo.question = newQuestion;
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

function parsePr(raw: unknown): RunPr | undefined {
  if (!isRecord(raw) || typeof raw.number !== 'number' || typeof raw.url !== 'string') return undefined;
  return { number: raw.number, url: raw.url, author: typeof raw.author === 'string' ? raw.author : '' };
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
    overview: typeof raw.overview === 'string' && raw.overview.trim() !== '' ? raw.overview.trim() : undefined,
    mode: isRunMode(raw.mode) ? raw.mode : undefined,
    pr: parsePr(raw.pr),
    contextDir: typeof raw.contextDir === 'string' && raw.contextDir !== '' ? raw.contextDir : undefined,
    session: isRecord(raw.session) ? (raw.session as Partial<Session>) : undefined,
    agents: Array.isArray(raw.agents) ? raw.agents.map(parseAgent) : undefined,
    todos: Array.isArray(raw.todos) ? raw.todos.map(parseTodoInput) : undefined,
  };
}

function categoryOf(input: TodoInput): TodoCategory {
  const requested = input.category ?? 'key-decision';
  if (requested !== 'key-decision') return requested;
  return councilAgrees(input.positions ?? [], input.recommendation ?? null) ? 'key-decision' : 'needs-you';
}

function toList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return raw.split(/\n+|;\s+/).map((part) => part.trim()).filter((part) => part !== '');
  return [];
}

function toStrings(raw: unknown): string[] {
  return toList(raw).map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
}

function normalizePosition(position: Position): Position {
  return position.evidence === undefined ? position : { ...position, evidence: toStrings(position.evidence) };
}

function normalizeTodo(todo: Todo): Todo {
  return {
    ...todo,
    options: toList(todo.options) as Todo['options'],
    positions: (toList(todo.positions) as Position[]).map(normalizePosition),
    tradeoffs: toStrings(todo.tradeoffs),
    caveats: toStrings(todo.caveats),
    evidence: toList(todo.evidence).map((item) => (typeof item === 'string' ? { ref: item } : item)) as Todo['evidence'],
    links: toList(todo.links) as Todo['links'],
    ...(todo.diffs !== undefined ? { diffs: toList(todo.diffs) as NonNullable<Todo['diffs']> } : {}),
    ...(todo.suggestedQuestions !== undefined ? { suggestedQuestions: toStrings(todo.suggestedQuestions) } : {}),
    ...(todo.conversation !== undefined ? { conversation: toList(todo.conversation) as NonNullable<Todo['conversation']> } : {}),
  };
}

export function normalizeRun(run: Run): Run {
  return { ...run, todos: toList(run.todos).map((todo) => normalizeTodo(todo as Todo)) };
}

function presetAnswer(input: TodoInput, category: TodoCategory, now: string): Todo['answer'] {
  const optionId = input.recommendation?.optionId;
  if (category !== 'key-decision' || optionId === undefined) return null;
  return { optionId, text: '', deferred: false, answeredAt: now, preset: true };
}

function toTodo(input: TodoInput, existing: Todo | undefined, now: string): Todo {
  const finding = input.kind === 'finding';
  const category = finding ? 'needs-you' : categoryOf(input);
  const preset = existing === undefined && !finding ? presetAnswer(input, category, now) : null;
  const staleCouncilPick =
    existing !== undefined && existing.state === 'answered' && existing.answer?.preset === true && category !== 'key-decision';
  return {
    id: input.id,
    kind: input.kind ?? 'decision',
    category,
    title: input.title,
    question: input.question ?? '',
    recommendation: finding ? null : (input.recommendation ?? null),
    options: finding ? [] : (input.options ?? []),
    positions: (toList(input.positions) as Position[]).map(normalizePosition),
    tradeoffs: input.tradeoffs ?? [],
    caveats: input.caveats ?? [],
    evidence: input.evidence ?? [],
    diffs: input.diffs ?? [],
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    ...(input.alsoRaisedAs !== undefined ? { alsoRaisedAs: input.alsoRaisedAs } : {}),
    ...(input.verification !== undefined ? { verification: input.verification } : {}),
    ...(input.draftComment !== undefined ? { draftComment: input.draftComment } : {}),
    ...(input.suggestedQuestions !== undefined ? { suggestedQuestions: input.suggestedQuestions } : {}),
    links: input.links ?? [],
    state: staleCouncilPick ? 'open' : (existing?.state ?? (preset === null ? 'open' : 'answered')),
    answer: staleCouncilPick ? null : (existing?.answer ?? preset),
    submittedAt: existing?.submittedAt ?? null,
    pickedUpAt: existing?.pickedUpAt ?? null,
    resolution: existing?.resolution ?? null,
    doneAt: existing?.doneAt,
    conversation: existing?.conversation,
  };
}

function modeFields(input: PushInput, existing: Run | null): Pick<Run, 'mode' | 'pr' | 'contextDir'> {
  const mode = input.mode ?? existing?.mode;
  const pr = input.pr ?? existing?.pr;
  const contextDir = input.contextDir ?? existing?.contextDir;
  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(contextDir !== undefined ? { contextDir } : {}),
  };
}

export function mergeRun(existing: Run | null, input: PushInput, fallbackSession: Session): Run {
  const now = new Date().toISOString();
  const existingTodos = existing?.todos ?? [];
  const existingById = new Map(existingTodos.map((todo) => [todo.id, todo]));
  const pushed = (input.todos ?? []).map((todo) => normalizeTodo(toTodo(todo, existingById.get(todo.id), now)));
  const pushedIds = new Set(pushed.map((todo) => todo.id));
  const kept = existingTodos.filter((todo) => !pushedIds.has(todo.id));
  return {
    version: 1,
    runId: input.runId,
    skill: input.skill,
    title: input.title,
    summary: input.summary ?? existing?.summary ?? '',
    overview: input.overview ?? existing?.overview ?? '',
    ...modeFields(input, existing),
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

function countTodos(runs: Run[], matches: (todo: Todo) => boolean): number {
  return runs.reduce((sum, run) => sum + run.todos.filter(matches).length, 0);
}

function sortTodos(run: Run): Run {
  const todos = [...run.todos].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
  return { ...run, todos };
}

function displayNameOf(names: ConductorNames | null, runTitle: string, workspaceName: string): string {
  if (names !== null) {
    if (names.userSetName && names.workspaceName !== '') return names.workspaceName;
    if (names.prTitle !== '') return names.prTitle;
    if (names.branch !== '') return names.branch;
  }
  return runTitle !== '' ? runTitle : workspaceName;
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

function overviewOf(runs: Run[]): string {
  const newestFirst = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return newestFirst.find((run) => run.overview !== undefined && run.overview !== '')?.overview ?? '';
}

function liveFor(state: LiveState, runs: Run[]): LiveState {
  const needsThinh = countTodos(runs, (todo) => todo.state === 'open') + countTodos(runs, isReadyToSubmit) > 0;
  return state === 'waiting_on_you' && !needsThinh ? 'idle' : state;
}

function latestActivity(times: (string | null | undefined)[]): string {
  const stamps = times
    .map((time) => (time === null || time === undefined ? Number.NaN : Date.parse(time)))
    .filter((stamp) => !Number.isNaN(stamp));
  return new Date(Math.max(...stamps)).toISOString();
}

function toThread(
  sessionId: string,
  groupRuns: Run[],
  info: LiveInfo | undefined,
  archived: boolean,
  steps: StepsFile | undefined,
  instantAsk: boolean,
): Thread {
  const runs = groupRuns.map(sortTodos);
  const latest = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] as Run;
  const names = info?.names ?? null;
  return {
    sessionId,
    archived,
    instantAsk,
    session: latest.session,
    displayName: displayNameOf(names, latest.title, latest.session.workspaceName),
    syncRequestedAt: null,
    description: descriptionOf(names, runs),
    summary: summaryOf(runs),
    overview: overviewOf(runs),
    mode: modeOf(latest),
    pr: latest.pr ?? null,
    live: liveFor(info?.state ?? 'dead', runs),
    step: steps?.current ?? null,
    steps: steps?.history ?? [],
    agents: mergeAgents(runs),
    runs,
    openCount: countTodos(runs, (todo) => todo.state === 'open'),
    answeredCount: countTodos(runs, isReadyToSubmit),
    updatedAt: latestActivity([latest.updatedAt, steps?.current?.at, steps?.history[steps.history.length - 1]?.at, info?.activityAt]),
  };
}

function agentFromId(id: string): Agent {
  const name = id.charAt(0).toUpperCase() + id.slice(1);
  if (id === 'opus' || id === 'claude') return { id, name, role: 'orchestrator', harness: 'claude', model: 'opus' };
  if (id === 'sonnet') return { id, name, role: 'worker', harness: 'claude', model: 'sonnet' };
  if (id === 'haiku') return { id, name, role: 'scout', harness: 'claude', model: 'haiku' };
  if (id === 'codex') return { id, name, role: 'council', harness: 'codex', model: 'codex' };
  if (id === 'grok') return { id, name, role: 'council', harness: 'cursor', model: 'grok' };
  return { id, name, role: 'council', harness: 'other', model: '' };
}

function agentsFromSteps(history: StepEntry[]): Agent[] {
  const ids = [...new Set(history.map((step) => step.agent ?? 'opus'))];
  return ids.map(agentFromId);
}

function toStepsOnlyThread(
  sessionId: string,
  info: LiveInfo | undefined,
  archived: boolean,
  steps: StepsFile,
  instantAsk: boolean,
): Thread {
  const names = info?.names ?? null;
  const session: Session = {
    conductorSessionId: sessionId,
    workspacePath: names?.workspacePath ?? '',
    workspaceName: names?.directoryName !== undefined && names.directoryName !== '' ? names.directoryName : sessionId,
    repo: names?.repoName ?? '',
    branch: names?.branch ?? '',
    pr: null,
  };
  return {
    sessionId,
    archived,
    instantAsk,
    session,
    displayName: displayNameOf(names, '', session.workspaceName),
    syncRequestedAt: null,
    description: names?.title ?? '',
    summary: '',
    overview: '',
    mode: 'build',
    pr: null,
    live: liveFor(info?.state ?? 'dead', []),
    step: steps.current,
    steps: steps.history,
    agents: agentsFromSteps(steps.history),
    runs: [],
    openCount: 0,
    answeredCount: 0,
    updatedAt: latestActivity([steps.current?.at, steps.history[steps.history.length - 1]?.at, info?.activityAt]),
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

export const INSTANT_ASK_TTL_MS = 60000;

export function recentlyPolled(lastPollAt: number | undefined, now: number): boolean {
  return lastPollAt !== undefined && now - lastPollAt < INSTANT_ASK_TTL_MS;
}

export function buildThreads(
  runs: Run[],
  live: ReadonlyMap<string, LiveInfo>,
  archived: ReadonlySet<string>,
  showArchived: boolean,
  steps: ReadonlyMap<string, StepsFile>,
  modPolls: ReadonlyMap<string, number>,
  customNames: Readonly<Record<string, string>> = {},
  syncs: ReadonlyMap<string, string> = new Map(),
): Thread[] {
  const groups = groupRunsBySession(runs);
  const withRuns = [...groups]
    .filter(([sessionId]) => showArchived || !archived.has(sessionId))
    .map(([sessionId, group]) =>
      toThread(sessionId, group, live.get(sessionId), archived.has(sessionId), steps.get(sessionId), recentlyPolled(modPolls.get(sessionId), Date.now())),
    );
  const stepsOnly = [...steps]
    .filter(([sessionId, file]) => file.current !== null && !groups.has(sessionId) && (showArchived || !archived.has(sessionId)))
    .map(([sessionId, file]) =>
      toStepsOnlyThread(sessionId, live.get(sessionId), archived.has(sessionId), file, recentlyPolled(modPolls.get(sessionId), Date.now())),
    );
  const threads = [...withRuns, ...stepsOnly].map((thread) => {
    const custom = customNames[thread.sessionId];
    const named = custom === undefined || custom === '' ? thread : { ...thread, displayName: custom };
    return { ...named, syncRequestedAt: syncs.get(thread.sessionId) ?? null };
  });
  return threads.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(threadGroup(a)) - GROUP_ORDER.indexOf(threadGroup(b)) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}
