import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeRun } from './store';

const SESSION = 'sync-session';

let home = '';
let base = '';
let server: ReturnType<typeof Bun.spawn> | undefined;

type Work = { questions: unknown[]; submitted: unknown[]; sync: { requestedAt: string } | null };

async function work(wait = 0): Promise<Work> {
  return (await (await fetch(`${base}/api/sessions/${SESSION}/work?wait=${wait}`)).json()) as Work;
}

async function post(path: string): Promise<Response> {
  return await fetch(`${base}${path}`, { method: 'POST' });
}

async function readPort(proc: ReturnType<typeof Bun.spawn>): Promise<number> {
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let seen = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`server exited: ${seen}`);
    seen += decoder.decode(value);
    const match = /Mission Control on http:\/\/[^:]+:(\d+)/.exec(seen);
    if (match !== null) return Number(match[1]);
  }
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'mc-sync-'));
  mkdirSync(join(home, 'runs'), { recursive: true });
  const run = mergeRun(
    null,
    { runId: 'sync-run', skill: 'avengers', title: 'Sync run', todos: [{ id: 'D1', title: 'Decide' }] },
    { conductorSessionId: SESSION, workspacePath: home, workspaceName: 'w', repo: 'r', branch: 'b', pr: null },
  );
  writeFileSync(join(home, 'runs', 'sync-run.json'), JSON.stringify(run));
  server = Bun.spawn([process.execPath, join(import.meta.dir, 'server.ts')], {
    env: { ...process.env, MC_HOME: home, PORT: '0', MC_NO_NOTIFY: '1', MC_CONDUCTOR_DB: join(home, 'none.db'), MC_FALLBACK_CMD: '/usr/bin/false' },
    stdout: 'pipe',
    stderr: 'ignore',
  });
  base = `http://127.0.0.1:${await readPort(server)}`;
});

afterAll(() => {
  server?.kill();
  rmSync(home, { recursive: true, force: true });
});

describe('sync from chat', () => {
  test('a request shows in the work response and in sync.json until the ack clears it', async () => {
    const first = await post(`/api/threads/${SESSION}/sync`);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { mod: boolean }).mod).toBe(false);
    await post(`/api/sessions/${SESSION}/sync/ack`);
    expect((await work()).sync).toBeNull();
    const second = await post(`/api/threads/${SESSION}/sync`);
    expect(((await second.json()) as { mod: boolean }).mod).toBe(true);
    const pending = await work();
    expect(pending.sync?.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(readFileSync(join(home, 'sync.json'), 'utf8'))[SESSION]).toBe(pending.sync?.requestedAt);
    const threads = (await (await fetch(`${base}/api/threads`)).json()) as { sessionId: string; syncRequestedAt: string | null }[];
    expect(threads.find((thread) => thread.sessionId === SESSION)?.syncRequestedAt).toBe(pending.sync?.requestedAt);
    expect((await work()).sync).not.toBeNull();
    expect((await post(`/api/sessions/${SESSION}/sync/ack`)).status).toBe(200);
    expect((await work()).sync).toBeNull();
    expect(JSON.parse(readFileSync(join(home, 'sync.json'), 'utf8'))).toEqual({});
  });

  test('the work long poll wakes as soon as a sync is requested', async () => {
    const started = Date.now();
    const waiting = work(20);
    await Bun.sleep(300);
    await post(`/api/threads/${SESSION}/sync`);
    const result = await waiting;
    expect(result.sync).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
    await post(`/api/sessions/${SESSION}/sync/ack`);
  });

  test('an unknown thread is a 404', async () => {
    expect((await post('/api/threads/nope/sync')).status).toBe(404);
  });
});
