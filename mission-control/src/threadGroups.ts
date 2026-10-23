import type { Thread } from './types';

export type ThreadGroup = 'needs' | 'working' | 'idle' | 'archived';

export const GROUP_LABEL: Record<ThreadGroup, string> = {
  needs: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  archived: 'Archived',
};

export const GROUP_ORDER: ThreadGroup[] = ['needs', 'working', 'idle', 'archived'];

export function threadGroup(thread: Thread): ThreadGroup {
  if (thread.archived) return 'archived';
  if (thread.openCount > 0 || thread.answeredCount > 0 || thread.live === 'waiting_on_you') return 'needs';
  if (thread.live === 'working') return 'working';
  return 'idle';
}
