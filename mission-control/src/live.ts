import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { groupRunsBySession } from './store';
import type { LiveState, Run } from './types';

const CONDUCTOR_DB = join(homedir(), 'Library/Application Support/com.conductor.app/conductor.db');
const WAIT_PATTERN = /(?:mc|mc\.ts) wait (\S+)/g;

type Process = { pid: number; command: string };

function dbStatuses(sessionIds: string[]): Map<string, string> {
  const statuses = new Map<string, string>();
  if (sessionIds.length === 0) return statuses;
  try {
    const db = new Database(CONDUCTOR_DB, { readonly: true });
    try {
      const marks = sessionIds.map(() => '?').join(',');
      const rows = db
        .query<{ id: string; status: string }, string[]>(`select id, status from sessions where id in (${marks})`)
        .all(...sessionIds);
      rows.forEach((row) => statuses.set(row.id, row.status));
    } finally {
      db.close();
    }
  } catch {
    return statuses;
  }
  return statuses;
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
}

async function listProcesses(): Promise<Process[]> {
  const output = await run(['ps', '-axo', 'pid=,command=']);
  return output
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ pid: Number(match[1]), command: match[2] as string }));
}

async function cwdsOf(pids: number[]): Promise<Set<string>> {
  const cwds = new Set<string>();
  if (pids.length === 0) return cwds;
  const output = await run(['lsof', '-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn']);
  output.split('\n').forEach((line) => {
    if (line.startsWith('n')) cwds.add(line.slice(1));
  });
  return cwds;
}

function pendingWaits(processes: Process[]): Set<string> {
  const runIds = new Set<string>();
  processes.forEach(({ command }) => {
    for (const match of command.matchAll(WAIT_PATTERN)) runIds.add(match[1] as string);
  });
  return runIds;
}

function resolveState(
  dbStatus: string | undefined,
  waitPending: boolean,
  alive: boolean,
): LiveState {
  if (dbStatus === 'error') return 'error';
  if (dbStatus === 'working') return 'working';
  if (waitPending || dbStatus === 'waiting') return 'waiting_on_you';
  return alive ? 'idle' : 'dead';
}

export async function computeLiveStates(runs: Run[]): Promise<Map<string, LiveState>> {
  const groups = groupRunsBySession(runs);
  const statuses = dbStatuses([...groups.keys()]);
  const processes = await listProcesses();
  const claudePids = processes.filter((p) => p.command.includes('/claude')).map((p) => p.pid);
  const aliveCwds = await cwdsOf(claudePids);
  const waits = pendingWaits(processes);
  const states = new Map<string, LiveState>();
  groups.forEach((group, sessionId) => {
    const waitPending = group.some((r) => waits.has(r.runId));
    const alive = aliveCwds.has((group[0] as Run).session.workspacePath);
    states.set(sessionId, resolveState(statuses.get(sessionId), waitPending, alive));
  });
  return states;
}
