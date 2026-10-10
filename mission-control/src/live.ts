import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ConductorNames, type LiveInfo, groupRunsBySession } from './store';
import type { LiveState, Run } from './types';

const CONDUCTOR_DB =
  process.env.MC_CONDUCTOR_DB ?? join(homedir(), 'Library/Application Support/com.conductor.app/conductor.db');
const WAIT_PATTERN = /(?:mc|mc\.ts) wait (\S+)/g;

type Process = { pid: number; command: string };

type SessionRow = {
  id: string;
  status: string;
  title: string | null;
  workspace_name: string | null;
  user_set_workspace_name: number | null;
  pr_title: string | null;
  branch: string | null;
};

type ConductorSession = { status: string; names: ConductorNames };

function toConductorSession(row: SessionRow): ConductorSession {
  return {
    status: row.status,
    names: {
      workspaceName: row.workspace_name ?? '',
      userSetName: row.user_set_workspace_name === 1,
      prTitle: row.pr_title ?? '',
      branch: row.branch ?? '',
      title: row.title ?? '',
    },
  };
}

function conductorSessions(sessionIds: string[]): Map<string, ConductorSession> {
  const sessions = new Map<string, ConductorSession>();
  if (sessionIds.length === 0) return sessions;
  try {
    const db = new Database(CONDUCTOR_DB, { readonly: true });
    try {
      const marks = sessionIds.map(() => '?').join(',');
      const rows = db
        .query<SessionRow, string[]>(
          `select s.id, s.status, s.title, w.workspace_name, w.user_set_workspace_name, w.pr_title, w.branch
           from sessions s left join workspaces w on w.local_id = s.workspace_id
           where s.id in (${marks})`,
        )
        .all(...sessionIds);
      rows.forEach((row) => sessions.set(row.id, toConductorSession(row)));
    } finally {
      db.close();
    }
  } catch {
    return sessions;
  }
  return sessions;
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

export async function activeWaits(): Promise<Set<string>> {
  return pendingWaits(await listProcesses());
}

export async function computeLiveInfo(runs: Run[]): Promise<Map<string, LiveInfo>> {
  const groups = groupRunsBySession(runs);
  const sessions = conductorSessions([...groups.keys()]);
  const processes = await listProcesses();
  const claudePids = processes.filter((p) => p.command.includes('/claude')).map((p) => p.pid);
  const aliveCwds = await cwdsOf(claudePids);
  const waits = pendingWaits(processes);
  const infos = new Map<string, LiveInfo>();
  groups.forEach((group, sessionId) => {
    const waitPending = group.some((r) => waits.has(r.runId));
    const alive = aliveCwds.has((group[0] as Run).session.workspacePath);
    const session = sessions.get(sessionId);
    infos.set(sessionId, {
      state: resolveState(session?.status, waitPending, alive),
      names: session?.names ?? null,
    });
  });
  return infos;
}
