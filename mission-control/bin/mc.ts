#!/usr/bin/env bun
import { existsSync, mkdirSync, openSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { threadPrompt, waitBlock } from '../src/prompt';
import {
  ensureRunsDir,
  listRuns,
  mcHome,
  mergeRun,
  parsePushInput,
  readRun,
  runsDir,
  updateRun,
  withRunLock,
  writeRun,
} from '../src/store';
import type { Run, Session } from '../src/types';

const DEFAULT_WAIT_MINUTES = 240;
const POLL_INTERVAL_MS = 1000;
const SERVER_PROBE_MS = 500;
const SERVER_PATH = join(import.meta.dir, '../src/server.ts');
const SLACK_NOTIFY = join(homedir(), '.claude/skills/ping/scripts/slack-notify.sh');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireArg(value: string | undefined, usage: string): string {
  if (value === undefined) fail(usage);
  return value;
}

function currentBranch(workspacePath: string): string {
  const result = Bun.spawnSync(['git', '-C', workspacePath, 'branch', '--show-current']);
  return result.stdout.toString().trim();
}

function sessionFromEnv(): Session {
  const workspacePath = process.env.CONDUCTOR_WORKSPACE_PATH ?? process.cwd();
  const workspaceName = basename(workspacePath);
  return {
    conductorSessionId: process.env.CONDUCTOR_SESSION_ID ?? `local-${workspaceName}`,
    workspacePath,
    workspaceName,
    repo: basename(dirname(workspacePath)),
    branch: currentBranch(workspacePath),
    pr: null,
  };
}

async function readInput(source: string): Promise<string> {
  return source === '-' ? await Bun.stdin.text() : await Bun.file(source).text();
}

function serverPort(): string {
  return process.env.PORT ?? '4747';
}

async function ensureServer(): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${serverPort()}/api/threads`, { signal: AbortSignal.timeout(SERVER_PROBE_MS) });
    return;
  } catch {
    mkdirSync(mcHome(), { recursive: true });
  }
  const log = openSync(join(mcHome(), 'server.log'), 'a');
  Bun.spawn([process.execPath, SERVER_PATH], {
    stdio: ['ignore', log, log],
    env: process.env,
    detached: true,
  }).unref();
}

function appleScriptString(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function fireAndForget(cmd: string[]): void {
  try {
    Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'], detached: true }).unref();
  } catch {
    return;
  }
}

function notifyNewTodos(run: Run, count: number): void {
  if (process.env.MC_NO_NOTIFY === '1') return;
  const workspace = run.session.workspaceName;
  const script = `display notification ${appleScriptString(`${count} new todos: ${run.title}`)} with title "Mission Control" subtitle ${appleScriptString(workspace)}`;
  fireAndForget(['osascript', '-e', script]);
  const token = process.env.ROCKY_OAUTH_TOKEN;
  if (token === undefined || token === '' || !existsSync(SLACK_NOTIFY)) return;
  fireAndForget([
    SLACK_NOTIFY,
    `Mission Control: ${count} new todos in ${workspace} (${run.title}) http://localhost:${serverPort()}`,
  ]);
}

async function push(args: string[]): Promise<void> {
  const source = args[0];
  if (source === undefined) fail('Usage: mc push <file|->');
  const input = parsePushInput(JSON.parse(await readInput(source)));
  const session = sessionFromEnv();
  const { run, newOpen } = await withRunLock(input.runId, () => {
    const existing = readRun(input.runId);
    const known = new Set(existing?.todos.map((todo) => todo.id));
    const merged = mergeRun(existing, input, session);
    writeRun(merged);
    const fresh = merged.todos.filter((todo) => !known.has(todo.id) && todo.state === 'open');
    return { run: merged, newOpen: fresh.length };
  });
  console.log(join(runsDir(), `${run.runId}.json`));
  await ensureServer();
  if (newOpen > 0) notifyNewTodos(run, newOpen);
}

function parseTimeoutMinutes(args: string[]): number {
  const index = args.indexOf('--timeout');
  if (index === -1) return DEFAULT_WAIT_MINUTES;
  const minutes = Number(args[index + 1]);
  if (Number.isNaN(minutes) || minutes <= 0) fail('--timeout needs a positive number of minutes');
  return minutes;
}

async function pickUpSubmitted(runId: string): Promise<{ run: Run; pickedIds: string[] } | null> {
  const current = readRun(runId);
  if (current === null || !current.todos.some((todo) => todo.state === 'submitted')) return null;
  const pickedIds: string[] = [];
  const at = new Date().toISOString();
  const run = await updateRun(runId, (target) => {
    target.todos.forEach((todo) => {
      if (todo.state !== 'submitted') return;
      todo.state = 'picked_up';
      todo.pickedUpAt = at;
      pickedIds.push(todo.id);
    });
  });
  return run === null ? null : { run, pickedIds };
}

function wait(runId: string, timeoutMinutes: number): Promise<number> {
  if (readRun(runId) === null) fail(`Run not found: ${runId}`);
  const timeoutMs = timeoutMinutes * 60 * 1000;
  ensureRunsDir();
  return new Promise((resolve) => {
    let finished = false;
    let checking = false;
    const watcher = watch(runsDir(), () => void check());
    const poll = setInterval(() => void check(), POLL_INTERVAL_MS);
    const timer = setTimeout(() => finish(`TIMEOUT ${runId}`, 2), timeoutMs);

    function finish(output: string, code: number): void {
      if (finished) return;
      finished = true;
      watcher.close();
      clearInterval(poll);
      clearTimeout(timer);
      console.log(output);
      resolve(code);
    }

    async function check(): Promise<void> {
      if (finished || checking) return;
      checking = true;
      try {
        const picked = await pickUpSubmitted(runId);
        if (picked === null) return;
        const todos = picked.run.todos.filter((todo) => picked.pickedIds.includes(todo.id));
        finish(waitBlock(picked.run, todos), 0);
      } finally {
        checking = false;
      }
    }

    void check();
  });
}

async function resolveTodo(args: string[]): Promise<void> {
  const [runId, todoId, ...text] = args;
  if (runId === undefined || todoId === undefined) fail('Usage: mc resolve <runId> <todoId> [text]');
  const run = await updateRun(runId, (target) => {
    const todo = target.todos.find((t) => t.id === todoId);
    if (todo === undefined) return;
    todo.state = 'done';
    todo.resolution = text.join(' ');
  });
  if (run === null || !run.todos.some((t) => t.id === todoId)) fail(`Todo not found: ${runId}/${todoId}`);
  console.log(`Resolved ${runId}/${todoId}`);
}

async function markDone(args: string[]): Promise<void> {
  const runId = args[0];
  if (runId === undefined) fail('Usage: mc done <runId>');
  const run = await updateRun(runId, (target) => {
    target.status = 'done';
  });
  if (run === null) fail(`Run not found: ${runId}`);
  console.log(`Done ${runId}`);
}

function printPrompt(args: string[]): void {
  const sessionId = args[0];
  if (sessionId === undefined) fail('Usage: mc prompt <sessionId>');
  const runs = listRuns().filter((run) => run.session.conductorSessionId === sessionId);
  if (runs.length === 0) fail(`No runs for session: ${sessionId}`);
  console.log(threadPrompt(runs));
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'serve':
      await import('../src/server');
      return 0;
    case 'push':
      await push(args);
      return 0;
    case 'wait':
      return await wait(requireArg(args[0], 'Usage: mc wait <runId> [--timeout <minutes>]'), parseTimeoutMinutes(args));
    case 'resolve':
      await resolveTodo(args);
      return 0;
    case 'done':
      await markDone(args);
      return 0;
    case 'prompt':
      printPrompt(args);
      return 0;
    default:
      return fail('Usage: mc <serve|push|wait|resolve|done|prompt> ...');
  }
}

process.exitCode = await main();
