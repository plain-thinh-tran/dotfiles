import { useEffect, useRef, useState } from 'react';
import type { Thread } from '../src/types';
import { prefersReducedMotion } from './motion';

const SEEN_PREFIX = 'mc-seen:';
const FLASH_MS = 1600;
const PRESENCE_MS = 20000;

function seenKeys(sessionId: string): Set<string> | null {
  const raw = localStorage.getItem(`${SEEN_PREFIX}${sessionId}`);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function todoKeys(thread: Thread, onlyOpen: boolean): string[] {
  return thread.runs.flatMap((run) =>
    run.todos.filter((todo) => !onlyOpen || todo.state === 'open').map((todo) => `${run.runId}/${todo.id}`),
  );
}

export function unseenCount(thread: Thread, selectedId: string | null): number {
  if (thread.sessionId === selectedId) return 0;
  const seen = seenKeys(thread.sessionId);
  if (seen === null) return 0;
  return todoKeys(thread, true).filter((key) => !seen.has(key)).length;
}

export function useNewTodos(threads: Thread[], selectedId: string | null): ReadonlySet<string> {
  const previous = useRef(new Map<string, number>());
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    threads.forEach((thread) => {
      const id = thread.sessionId;
      if (id === selectedId || seenKeys(id) === null) {
        localStorage.setItem(`${SEEN_PREFIX}${id}`, JSON.stringify(todoKeys(thread, false)));
        previous.current.set(id, 0);
        return;
      }
      const count = unseenCount(thread, selectedId);
      const before = previous.current.get(id);
      previous.current.set(id, count);
      if (before === undefined || count <= before || prefersReducedMotion()) return;
      setFlashing((current) => new Set(current).add(id));
      setTimeout(() => {
        setFlashing((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, FLASH_MS);
    });
  }, [threads, selectedId]);
  return flashing;
}

export function usePresence(): void {
  useEffect(() => {
    const report = () => {
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      void fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focused }),
      }).catch(() => undefined);
    };
    report();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') report();
    }, PRESENCE_MS);
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      document.removeEventListener('visibilitychange', report);
    };
  }, []);
}
