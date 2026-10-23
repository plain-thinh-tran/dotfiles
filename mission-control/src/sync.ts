import type { Thread } from './types';

export function isSyncing(thread: Pick<Thread, 'syncRequestedAt' | 'runs'>): boolean {
  const requestedAt = thread.syncRequestedAt;
  return requestedAt !== null && thread.runs.every((run) => run.updatedAt <= requestedAt);
}
