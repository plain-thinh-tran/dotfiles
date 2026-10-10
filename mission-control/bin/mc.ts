#!/usr/bin/env bun
import { existsSync, mkdirSync, openSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { downloadMissingAvatars } from '../src/avatarFiles';
import { isAwaitingPickup, threadPrompt, waitBlock } from '../src/prompt';
import {
  clearStep,
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
  writeStep,
} from '../src/store';
import type { Run, Session, Todo } from '../src/types';

const DEFAULT_WAIT_MINUTES = 240;
const POLL_INTERVAL_MS = 1000;
const SERVER_PROBE_MS = 500;
const SERVER_START_MS = 8000;
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

async function appIsFocused(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort()}/api/presence`, { signal: AbortSignal.timeout(SERVER_PROBE_MS) });
    return ((await response.json()) as { focused: boolean }).focused;
  } catch {
    return false;
  }
}

async function notifyNewTodos(run: Run, count: number): Promise<void> {
  if (process.env.MC_NO_NOTIFY === '1') return;
  const workspace = run.session.workspaceName;
  const script = `display notification ${appleScriptString(`${count} new todos: ${run.title}`)} with title "Mission Control" subtitle ${appleScriptString(workspace)}`;
  if (!(await appIsFocused())) fireAndForget(['osascript', '-e', script]);
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
  if (newOpen > 0) await notifyNewTodos(run, newOpen);
}

function parseTimeoutMinutes(args: string[]): number {
  const index = args.indexOf('--timeout');
  if (index === -1) return DEFAULT_WAIT_MINUTES;
  const minutes = Number(args[index + 1]);
  if (Number.isNaN(minutes) || minutes <= 0) fail('--timeout needs a positive number of minutes');
  return minutes;
}

async function pickUpSubmitted(runId: string): Promise<{ run: Run; picked: Todo[] } | null> {
  const current = readRun(runId);
  if (current === null || !current.todos.some(isAwaitingPickup)) return null;
  const picked: Todo[] = [];
  const at = new Date().toISOString();
  const run = await updateRun(runId, (target) => {
    target.todos.filter(isAwaitingPickup).forEach((todo) => {
      picked.push(structuredClone(todo));
      if (todo.answer?.question === true) {
        todo.conversation = [...(todo.conversation ?? []), { from: 'thinh', text: todo.answer.text, at }];
        todo.answer = null;
        todo.state = 'open';
        todo.submittedAt = null;
        return;
      }
      todo.state = 'picked_up';
      todo.pickedUpAt = at;
    });
  });
  return run === null ? null : { run, picked };
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
        finish(waitBlock(picked.run, picked.picked), 0);
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
    todo.doneAt = new Date().toISOString();
    todo.resolution = text.join(' ');
  });
  if (run === null || !run.todos.some((t) => t.id === todoId)) fail(`Todo not found: ${runId}/${todoId}`);
  console.log(`Resolved ${runId}/${todoId}`);
}

async function reply(args: string[]): Promise<void> {
  const newQuestion = flagValue(args, '--question');
  const positional = args.filter((arg, index) => arg !== '--question' && args[index - 1] !== '--question');
  const [runId, todoId, ...words] = positional;
  const text = words.join(' ').trim();
  if (runId === undefined || todoId === undefined || text === '') {
    fail('Usage: mc reply <runId> <todoId> "<text>" [--question "<new question text>"]');
  }
  const run = await updateRun(runId, (target) => {
    const todo = target.todos.find((t) => t.id === todoId);
    if (todo === undefined) return;
    todo.conversation = [...(todo.conversation ?? []), { from: 'agent', text, at: new Date().toISOString() }];
    if (newQuestion !== undefined) todo.question = newQuestion;
  });
  if (run === null || !run.todos.some((t) => t.id === todoId)) fail(`Todo not found: ${runId}/${todoId}`);
  console.log(`Replied on ${runId}/${todoId}`);
}

async function openApp(): Promise<void> {
  await ensureServer();
  const url = `http://localhost:${serverPort()}`;
  const deadline = Date.now() + SERVER_START_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/api/threads`, { signal: AbortSignal.timeout(SERVER_PROBE_MS) });
      break;
    } catch {
      await Bun.sleep(150);
    }
  }
  await Bun.spawn(['open', url], { stdio: ['ignore', 'ignore', 'ignore'] }).exited;
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

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function step(args: string[]): Promise<void> {
  const sessionId = flagValue(args, '--session') ?? process.env.CONDUCTOR_SESSION_ID;
  if (sessionId === undefined || sessionId === '') fail('mc step needs CONDUCTOR_SESSION_ID or --session <id>');
  const agent = flagValue(args, '--agent');
  const flagValues = new Set([flagValue(args, '--session'), agent].filter((value) => value !== undefined));
  const positional = args.filter((arg) => !arg.startsWith('--') && !flagValues.has(arg));
  if (args.includes('--clear')) {
    await clearStep(sessionId);
    console.log(`Cleared step for ${sessionId}`);
    return;
  }
  const text = positional.join(' ').trim();
  if (text === '') fail('Usage: mc step "<text>" [--agent <agentId>] [--session <id>] | mc step --clear');
  console.log(await writeStep(sessionId, text, agent ?? null));
}

async function avatars(): Promise<number> {
  const { present, downloaded, failed } = await downloadMissingAvatars();
  console.log(`Avatars: ${present} present, ${downloaded} downloaded, ${failed} failed`);
  return failed > 0 ? 1 : 0;
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
    case 'reply':
      await reply(args);
      return 0;
    case 'open':
      await openApp();
      return 0;
    case 'step':
      await step(args);
      return 0;
    case 'avatars':
      return await avatars();
    case 'prompt':
      printPrompt(args);
      return 0;
    default:
      return fail('Usage: mc <serve|open|push|wait|reply|resolve|done|prompt|step|avatars> ...');
  }
}

process.exitCode = await main();
