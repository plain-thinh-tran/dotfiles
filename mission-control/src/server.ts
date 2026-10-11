import { watch } from 'node:fs';
import index from '../web/index.html';
import { avatarPath, downloadMissingAvatars, isAvatarId } from './avatarFiles';
import { answerWithFallback } from './fallbackAsk';
import { activeWaits, computeLiveInfo } from './live';
import {
  isAwaitingPickup,
  isDeliverableQuestion,
  isLocked,
  isReadyToSubmit,
  latestThinhMessage,
  pendingQuestion,
  threadPrompt,
} from './prompt';
import { questionsOf } from './questions';
import {
  addQuestion,
  addReply,
  buildThreads,
  markFallbackFailed,
  patchLatestThinh,
  withoutSubmission,
  ensureRunsDir,
  type LiveInfo,
  groupRunsBySession,
  listRuns,
  pruneRuns,
  readArchived,
  readSteps,
  recentlyPolled,
  ensureStepsDir,
  stepsDir,
  readRun,
  runsDir,
  setArchived,
  withRunLock,
  writeRun,
} from './store';
import type { Run, Todo } from './types';

const PORT = Number(process.env.PORT ?? 4747);
const LIVE_INTERVAL_MS = 3000;
const PING_INTERVAL_MS = 15000;
const PRESENCE_TTL_MS = 30000;

type AnswerBody = { optionId: string | null; text: string; deferred: boolean; question?: boolean };
type TodoRequest = Request & { params: { runId: string; todoId: string } };
type ThreadRequest = Request & { params: { sessionId: string } };
type Client = { controller: ReadableStreamDefaultController<Uint8Array>; archived: boolean };

const encoder = new TextEncoder();
const clients = new Set<Client>();
let liveStates = new Map<string, LiveInfo>();
let lastFocusedAt = 0;
const lastModPollAt = new Map<string, number>();
const fallbackRunning = new Set<string>();

function wantsArchived(req: Request): boolean {
  return new URL(req.url).searchParams.get('archived') === '1';
}

function currentThreads(showArchived: boolean) {
  return buildThreads(listRuns(), liveStates, readArchived(), showArchived, readSteps(), lastModPollAt);
}

function notFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

function conflict(message: string): Response {
  return Response.json({ error: message }, { status: 409 });
}

function parseAnswerBody(raw: unknown): AnswerBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { optionId, text, deferred, question } = raw as Record<string, unknown>;
  if (optionId !== null && typeof optionId !== 'string') return null;
  if (typeof text !== 'string' || typeof deferred !== 'boolean') return null;
  if (question !== undefined && typeof question !== 'boolean') return null;
  return question === true ? { optionId, text, deferred, question } : { optionId, text, deferred };
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function mutateTodo(
  req: TodoRequest,
  allowed: (todo: Todo) => boolean,
  apply: (todo: Todo) => void,
): Promise<Response> {
  const { runId, todoId } = req.params;
  return await withRunLock(runId, () => {
    const run = readRun(runId);
    const todo = run?.todos.find((t) => t.id === todoId);
    if (run === null || todo === undefined) return notFound(`Todo ${runId}/${todoId} not found`);
    if (!allowed(todo)) return conflict(`Todo is ${todo.state}`);
    apply(todo);
    run.updatedAt = new Date().toISOString();
    writeRun(run);
    return Response.json({ ok: true });
  });
}

async function answerTodo(req: TodoRequest): Promise<Response> {
  const body = parseAnswerBody(await readJson(req));
  if (body === null) return Response.json({ error: 'Invalid answer body' }, { status: 400 });
  return await mutateTodo(
    req,
    (todo) => !isLocked(todo),
    (todo) => {
      todo.state = 'answered';
      todo.answer = { ...body, answeredAt: new Date().toISOString() };
    },
  );
}

async function dismissTodo(req: TodoRequest): Promise<Response> {
  return await mutateTodo(
    req,
    (todo) => !isLocked(todo),
    (todo) => {
      todo.state = 'dismissed';
    },
  );
}

async function reopenTodo(req: TodoRequest): Promise<Response> {
  return await mutateTodo(
    req,
    (todo) => todo.state === 'answered' || todo.state === 'dismissed' || todo.state === 'understood' || todo.state === 'dropped',
    (todo) => {
      todo.state = 'open';
      todo.answer = null;
      delete todo.doneAt;
    },
  );
}

function settleFinding(req: TodoRequest, state: 'understood' | 'dropped'): Promise<Response> {
  return mutateTodo(
    req,
    (todo) => todo.kind === 'finding' && !isLocked(todo),
    (todo) => {
      todo.state = state;
      todo.doneAt = new Date().toISOString();
    },
  );
}

async function commentOnFinding(req: TodoRequest): Promise<Response> {
  const text = await textBody(req);
  if (text === null) return Response.json({ error: 'Invalid comment body' }, { status: 400 });
  return await mutateTodo(
    req,
    (todo) => todo.kind === 'finding' && !isLocked(todo),
    (todo) => {
      todo.state = 'answered';
      todo.answer = { optionId: null, text, deferred: false, answeredAt: new Date().toISOString(), comment: true };
    },
  );
}

type SubmissionResult = { count: number; questions: number; submissionId: string | null };

function submitRun(runId: string, at: string): SubmissionResult {
  const run = readRun(runId);
  if (run === null) return { count: 0, questions: 0, submissionId: null };
  const answered = run.todos.filter(isReadyToSubmit);
  const asked = run.todos.filter((todo) => isDeliverableQuestion(todo, Date.now()));
  if (answered.length === 0 && asked.length === 0) return { count: 0, questions: 0, submissionId: null };
  answered.forEach((todo) => {
    todo.state = 'submitted';
    todo.submittedAt = at;
  });
  asked.forEach((todo) => patchLatestThinh(todo, { submittedAt: at }));
  const submissionId = crypto.randomUUID();
  run.submissions.push({
    id: submissionId,
    at,
    todoIds: answered.map((todo) => todo.id),
    questionTodoIds: asked.map((todo) => todo.id),
  });
  run.updatedAt = at;
  writeRun(run);
  return { count: answered.length, questions: asked.length, submissionId };
}

async function submitThread(req: ThreadRequest): Promise<Response> {
  const runs = groupRunsBySession(listRuns()).get(req.params.sessionId);
  if (runs === undefined) return notFound('Thread not found');
  const at = new Date().toISOString();
  let submitted = 0;
  let questions = 0;
  const submissionIds: string[] = [];
  for (const run of runs) {
    const result = await withRunLock(run.runId, () => submitRun(run.runId, at));
    submitted += result.count;
    questions += result.questions;
    if (result.submissionId !== null) submissionIds.push(result.submissionId);
  }
  return Response.json({ submitted, questions, submissionIds });
}

async function unsubmitThread(req: ThreadRequest): Promise<Response> {
  const runs = groupRunsBySession(listRuns()).get(req.params.sessionId);
  if (runs === undefined) return notFound('Thread not found');
  const body = await readJson(req);
  const submissionId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).submissionId : undefined;
  if (typeof submissionId !== 'string') return Response.json({ error: 'Invalid unsubmit body' }, { status: 400 });
  const owner = runs.find((run) => run.submissions.some((submission) => submission.id === submissionId));
  if (owner === undefined) return notFound('Submission not found');
  const result = await withRunLock(owner.runId, () => {
    const run = readRun(owner.runId);
    const submission = run?.submissions.find((candidate) => candidate.id === submissionId);
    if (run === null || submission === undefined) return { reverted: 0, pickedUp: 0 };
    const targets = run.todos.filter((todo) => submission.todoIds.includes(todo.id));
    const waiting = targets.filter(isAwaitingPickup);
    waiting.forEach((todo) => {
      todo.state = 'answered';
      todo.submittedAt = null;
    });
    const asked = run.todos.filter((todo) => (submission.questionTodoIds ?? []).includes(todo.id));
    const undelivered = asked.filter((todo) => {
      const latest = latestThinhMessage(todo);
      return latest?.submittedAt === submission.at && latest.deliveredAt === undefined;
    });
    undelivered.forEach(withoutSubmission);
    const reverted = waiting.length + undelivered.length;
    if (reverted > 0) {
      run.submissions = run.submissions.filter((candidate) => candidate.id !== submissionId);
      run.updatedAt = new Date().toISOString();
      writeRun(run);
    }
    return { reverted, pickedUp: targets.length - waiting.length + asked.length - undelivered.length };
  });
  return Response.json(result);
}

async function serveAvatar(req: Request & { params: { file: string } }): Promise<Response> {
  const match = /^(\d+)\.png$/.exec(req.params.file);
  const id = match === null ? NaN : Number(match[1]);
  if (!isAvatarId(id)) return notFound('Unknown avatar');
  const file = Bun.file(avatarPath(id));
  if (!(await file.exists())) return notFound('Avatar not downloaded');
  return new Response(file, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}

async function textBody(req: Request): Promise<string | null> {
  const body = await readJson(req);
  const text = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).text : undefined;
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
}

async function askTodo(req: TodoRequest): Promise<Response> {
  const text = await textBody(req);
  if (text === null) return Response.json({ error: 'Invalid ask body' }, { status: 400 });
  const { runId, todoId } = req.params;
  if (!(await addQuestion(runId, todoId, text))) return notFound(`Todo ${runId}/${todoId} not found`);
  void answerAsFallback(runId, todoId);
  return Response.json({ ok: true });
}

async function answerAsFallback(runId: string, todoId: string): Promise<void> {
  const key = `${runId}/${todoId}`;
  const run = readRun(runId);
  if (run === null || fallbackRunning.has(key)) return;
  const { conductorSessionId, workspacePath } = run.session;
  if (recentlyPolled(lastModPollAt.get(conductorSessionId), Date.now())) return;
  const question = questionsOf(run).find((candidate) => candidate.todoId === todoId);
  if (question === undefined) return;
  if (workspacePath === '') {
    await markFallbackFailed(runId, todoId, question.text);
    return;
  }
  fallbackRunning.add(key);
  try {
    const answer = await answerWithFallback(question, conductorSessionId, workspacePath);
    const current = readRun(runId)?.todos.find((todo) => todo.id === todoId);
    if (answer === null) {
      await markFallbackFailed(runId, todoId, question.text);
    } else if (current !== undefined && pendingQuestion(current) === question.text) {
      await addReply(runId, todoId, answer);
    }
  } finally {
    fallbackRunning.delete(key);
  }
  const latest = readRun(runId)?.todos.find((todo) => todo.id === todoId);
  if (latest !== undefined && pendingQuestion(latest) !== null && pendingQuestion(latest) !== question.text) {
    void answerAsFallback(runId, todoId);
  }
}

async function replyTodo(req: TodoRequest): Promise<Response> {
  const text = await textBody(req);
  if (text === null) return Response.json({ error: 'Invalid reply body' }, { status: 400 });
  const { runId, todoId } = req.params;
  if (!(await addReply(runId, todoId, text))) return notFound(`Todo ${runId}/${todoId} not found`);
  return Response.json({ ok: true });
}

const workWaiters = new Set<() => void>();

function notifyWork(): void {
  workWaiters.forEach((wake) => wake());
  workWaiters.clear();
}

function nextChange(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      workWaiters.delete(wake);
      resolve();
    }, ms);
    function wake(): void {
      clearTimeout(timer);
      resolve();
    }
    workWaiters.add(wake);
  });
}

async function collectWork(sessionId: string) {
  const runs = groupRunsBySession(listRuns()).get(sessionId) ?? [];
  const waits = await activeWaits();
  const submitted = runs
    .map((run) => ({
      runId: run.runId,
      todoIds: run.todos.filter(isAwaitingPickup).map((todo) => todo.id),
      waitActive: waits.has(run.runId),
    }))
    .filter((entry) => entry.todoIds.length > 0);
  return { questions: runs.flatMap(questionsOf), submitted };
}

async function sessionWork(req: Request & { params: { sessionId: string } }, timeout: (req: Request, seconds: number) => void): Promise<Response> {
  const waitSeconds = Math.min(Number(new URL(req.url).searchParams.get('wait') ?? '0') || 0, 50);
  const deadline = Date.now() + waitSeconds * 1000;
  if (waitSeconds > 0) timeout(req, waitSeconds + 10);
  lastModPollAt.set(req.params.sessionId, Date.now());
  let work = await collectWork(req.params.sessionId);
  while (work.questions.length === 0 && work.submitted.every((s) => s.waitActive) && Date.now() < deadline) {
    await nextChange(deadline - Date.now());
    work = await collectWork(req.params.sessionId);
  }
  lastModPollAt.set(req.params.sessionId, Date.now());
  return Response.json(work);
}

async function setPresence(req: Request): Promise<Response> {
  const body = await readJson(req);
  const focused = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).focused : undefined;
  if (typeof focused !== 'boolean') return Response.json({ error: 'Invalid presence body' }, { status: 400 });
  lastFocusedAt = focused ? Date.now() : 0;
  return Response.json({ ok: true });
}

function getPresence(): Response {
  return Response.json({ focused: Date.now() - lastFocusedAt < PRESENCE_TTL_MS });
}

function threadExists(sessionId: string): boolean {
  return groupRunsBySession(listRuns()).has(sessionId) || runningSessionIds().includes(sessionId);
}

async function archiveThread(req: ThreadRequest, archived: boolean): Promise<Response> {
  const { sessionId } = req.params;
  if (archived && !threadExists(sessionId)) return notFound('Thread not found');
  await setArchived(sessionId, archived);
  broadcast();
  return Response.json({ ok: true });
}

async function focusConductor(): Promise<Response> {
  const proc = Bun.spawn(['open', '-a', 'Conductor'], { stdout: 'ignore', stderr: 'ignore' });
  const code = await proc.exited;
  return Response.json({ ok: code === 0 }, { status: code === 0 ? 200 : 500 });
}

function threadPromptResponse(req: ThreadRequest): Response {
  const runs = groupRunsBySession(listRuns()).get(req.params.sessionId);
  if (runs === undefined && !threadExists(req.params.sessionId)) return notFound('Thread not found');
  return Response.json({ text: threadPrompt(runs ?? []) });
}

function send(client: Client, chunk: string): void {
  try {
    client.controller.enqueue(encoder.encode(chunk));
  } catch {
    clients.delete(client);
  }
}

function broadcast(): void {
  notifyWork();
  if (clients.size === 0) return;
  const payloads = new Map<boolean, string>();
  clients.forEach((client) => {
    if (!payloads.has(client.archived)) {
      payloads.set(client.archived, `event: threads\ndata: ${JSON.stringify(currentThreads(client.archived))}\n\n`);
    }
    send(client, payloads.get(client.archived) as string);
  });
}

function openEventStream(req: Request, timeout: (req: Request, seconds: number) => void): Response {
  timeout(req, 0);
  const archived = wantsArchived(req);
  let client: Client | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { controller, archived };
      clients.add(client);
      send(client, `event: threads\ndata: ${JSON.stringify(currentThreads(archived))}\n\n`);
    },
    cancel() {
      if (client !== undefined) clients.delete(client);
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

let refreshing = false;

function runningSessionIds(): string[] {
  return [...readSteps()].filter(([, file]) => file.current !== null).map(([sessionId]) => sessionId);
}

async function refreshLive(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await computeLiveInfo(listRuns(), runningSessionIds());
    const changed = JSON.stringify([...next]) !== JSON.stringify([...liveStates]);
    liveStates = next;
    if (changed) broadcast();
  } catch (err) {
    console.error('Live state refresh failed', err);
  } finally {
    refreshing = false;
  }
}

function watchRuns(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refreshLive();
      broadcast();
    }, 50);
  };
  watch(runsDir(), onChange);
  watch(stepsDir(), onChange);
}

ensureRunsDir();
ensureStepsDir();
pruneRuns();
await refreshLive();
void downloadMissingAvatars().catch((err) => console.error('Avatar download failed', err));

const server = Bun.serve({
  development: process.env.MC_DEV === '1',
  hostname: '127.0.0.1',
  port: PORT,
  routes: {
    '/': index,
    '/api/threads': { GET: (req) => Response.json(currentThreads(wantsArchived(req))) },
    '/api/events': { GET: (req, srv) => openEventStream(req, (r, s) => srv.timeout(r, s)) },
    '/api/runs/:runId/todos/:todoId/answer': { POST: (req: TodoRequest) => answerTodo(req) },
    '/api/runs/:runId/todos/:todoId/dismiss': { POST: (req: TodoRequest) => dismissTodo(req) },
    '/api/runs/:runId/todos/:todoId/understood': { POST: (req: TodoRequest) => settleFinding(req, 'understood') },
    '/api/runs/:runId/todos/:todoId/drop': { POST: (req: TodoRequest) => settleFinding(req, 'dropped') },
    '/api/runs/:runId/todos/:todoId/comment': { POST: (req: TodoRequest) => commentOnFinding(req) },
    '/api/runs/:runId/todos/:todoId/reopen': { POST: (req: TodoRequest) => reopenTodo(req) },
    '/avatars/:file': { GET: (req: Request & { params: { file: string } }) => serveAvatar(req) },
    '/api/runs/:runId/todos/:todoId/ask': { POST: (req: TodoRequest) => askTodo(req) },
    '/api/runs/:runId/todos/:todoId/reply': { POST: (req: TodoRequest) => replyTodo(req) },
    '/api/sessions/:sessionId/work': { GET: (req: Request & { params: { sessionId: string } }, srv) => sessionWork(req, (r, sec) => srv.timeout(r, sec)) },
    '/api/presence': { GET: () => getPresence(), POST: (req) => setPresence(req) },
    '/api/focus-conductor': { POST: () => focusConductor() },
    '/api/threads/:sessionId/archive': { POST: (req: ThreadRequest) => archiveThread(req, true) },
    '/api/threads/:sessionId/unarchive': { POST: (req: ThreadRequest) => archiveThread(req, false) },
    '/api/threads/:sessionId/unsubmit': { POST: (req: ThreadRequest) => unsubmitThread(req) },
    '/api/threads/:sessionId/submit': { POST: (req: ThreadRequest) => submitThread(req) },
    '/api/threads/:sessionId/prompt': { GET: (req: ThreadRequest) => threadPromptResponse(req) },
  },
});

watchRuns();
setInterval(() => void refreshLive(), LIVE_INTERVAL_MS);
setInterval(() => clients.forEach((client) => send(client, ': ping\n\n')), PING_INTERVAL_MS);
console.log(`Mission Control on http://${server.hostname}:${server.port}`);
