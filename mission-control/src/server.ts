import { watch } from 'node:fs';
import index from '../web/index.html';
import { computeLiveStates } from './live';
import { threadPrompt } from './prompt';
import {
  buildThreads,
  ensureRunsDir,
  groupRunsBySession,
  listRuns,
  pruneRuns,
  readRun,
  runsDir,
  withRunLock,
  writeRun,
} from './store';
import type { LiveState, Run, Todo, TodoState } from './types';

const PORT = Number(process.env.PORT ?? 4747);
const LIVE_INTERVAL_MS = 3000;
const PING_INTERVAL_MS = 15000;
const LOCKED_STATES: TodoState[] = ['submitted', 'picked_up', 'done'];

type AnswerBody = { optionId: string | null; text: string; deferred: boolean };
type TodoRequest = Request & { params: { runId: string; todoId: string } };
type ThreadRequest = Request & { params: { sessionId: string } };
type Client = { controller: ReadableStreamDefaultController<Uint8Array>; done: boolean };

const encoder = new TextEncoder();
const clients = new Set<Client>();
let liveStates = new Map<string, LiveState>();

function wantsDone(req: Request): boolean {
  return new URL(req.url).searchParams.get('done') === '1';
}

function currentThreads(done: boolean) {
  return buildThreads(listRuns(), liveStates, done);
}

function notFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

function conflict(message: string): Response {
  return Response.json({ error: message }, { status: 409 });
}

function parseAnswerBody(raw: unknown): AnswerBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { optionId, text, deferred } = raw as Record<string, unknown>;
  if (optionId !== null && typeof optionId !== 'string') return null;
  if (typeof text !== 'string' || typeof deferred !== 'boolean') return null;
  return { optionId, text, deferred };
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
    (todo) => !LOCKED_STATES.includes(todo.state),
    (todo) => {
      todo.state = 'answered';
      todo.answer = { ...body, answeredAt: new Date().toISOString() };
    },
  );
}

async function dismissTodo(req: TodoRequest): Promise<Response> {
  return await mutateTodo(
    req,
    (todo) => !LOCKED_STATES.includes(todo.state),
    (todo) => {
      todo.state = 'dismissed';
    },
  );
}

async function reopenTodo(req: TodoRequest): Promise<Response> {
  return await mutateTodo(
    req,
    (todo) => todo.state === 'answered' || todo.state === 'dismissed',
    (todo) => {
      todo.state = 'open';
      todo.answer = null;
    },
  );
}

function submitRun(runId: string, at: string): number {
  const run = readRun(runId);
  if (run === null) return 0;
  const answered = run.todos.filter((todo) => todo.state === 'answered');
  if (answered.length === 0) return 0;
  answered.forEach((todo) => {
    todo.state = 'submitted';
    todo.submittedAt = at;
  });
  run.submissions.push({ id: crypto.randomUUID(), at, todoIds: answered.map((todo) => todo.id) });
  run.updatedAt = at;
  writeRun(run);
  return answered.length;
}

async function submitThread(req: ThreadRequest): Promise<Response> {
  const runs = groupRunsBySession(listRuns()).get(req.params.sessionId);
  if (runs === undefined) return notFound('Thread not found');
  const at = new Date().toISOString();
  let submitted = 0;
  for (const run of runs) {
    submitted += await withRunLock(run.runId, () => submitRun(run.runId, at));
  }
  return Response.json({ submitted });
}

async function focusConductor(): Promise<Response> {
  const proc = Bun.spawn(['open', '-a', 'Conductor'], { stdout: 'ignore', stderr: 'ignore' });
  const code = await proc.exited;
  return Response.json({ ok: code === 0 }, { status: code === 0 ? 200 : 500 });
}

function threadPromptResponse(req: ThreadRequest): Response {
  const runs = groupRunsBySession(listRuns()).get(req.params.sessionId);
  if (runs === undefined) return notFound('Thread not found');
  return Response.json({ text: threadPrompt(runs) });
}

function send(client: Client, chunk: string): void {
  try {
    client.controller.enqueue(encoder.encode(chunk));
  } catch {
    clients.delete(client);
  }
}

function broadcast(): void {
  if (clients.size === 0) return;
  const payloads = new Map<boolean, string>();
  clients.forEach((client) => {
    if (!payloads.has(client.done)) {
      payloads.set(client.done, `event: threads\ndata: ${JSON.stringify(currentThreads(client.done))}\n\n`);
    }
    send(client, payloads.get(client.done) as string);
  });
}

function openEventStream(req: Request, timeout: (req: Request, seconds: number) => void): Response {
  timeout(req, 0);
  const done = wantsDone(req);
  let client: Client | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { controller, done };
      clients.add(client);
      send(client, `event: threads\ndata: ${JSON.stringify(currentThreads(done))}\n\n`);
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

async function refreshLive(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await computeLiveStates(listRuns());
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
  watch(runsDir(), () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refreshLive();
      broadcast();
    }, 50);
  });
}

ensureRunsDir();
pruneRuns();
await refreshLive();

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  routes: {
    '/': index,
    '/api/threads': { GET: (req) => Response.json(currentThreads(wantsDone(req))) },
    '/api/events': { GET: (req, srv) => openEventStream(req, (r, s) => srv.timeout(r, s)) },
    '/api/runs/:runId/todos/:todoId/answer': { POST: (req: TodoRequest) => answerTodo(req) },
    '/api/runs/:runId/todos/:todoId/dismiss': { POST: (req: TodoRequest) => dismissTodo(req) },
    '/api/runs/:runId/todos/:todoId/reopen': { POST: (req: TodoRequest) => reopenTodo(req) },
    '/api/focus-conductor': { POST: () => focusConductor() },
    '/api/threads/:sessionId/submit': { POST: (req: ThreadRequest) => submitThread(req) },
    '/api/threads/:sessionId/prompt': { GET: (req: ThreadRequest) => threadPromptResponse(req) },
  },
});

watchRuns();
setInterval(() => void refreshLive(), LIVE_INTERVAL_MS);
setInterval(() => clients.forEach((client) => send(client, ': ping\n\n')), PING_INTERVAL_MS);
console.log(`Mission Control on http://${server.hostname}:${server.port}`);
