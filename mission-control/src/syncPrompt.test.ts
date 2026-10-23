import { describe, expect, test } from 'bun:test';
import { isSyncing } from './sync';
import { SYNC_PROMPT, syncPrompt } from './syncPrompt';
import type { Run } from './types';

const runAt = (updatedAt: string) => ({ updatedAt }) as Run;

describe('sync prompt', () => {
  test('names the resolve and push commands and lists the thread run ids', () => {
    expect(SYNC_PROMPT).toContain('~/.claude/bin/mc resolve <runId> <id> "settled in chat: <what was decided>"');
    expect(SYNC_PROMPT).toContain('update mc.json and run ~/.claude/bin/mc push');
    expect(syncPrompt(['prc-a-1', 'avengers-2'])).toBe(`${SYNC_PROMPT}\n\nRuns: prc-a-1, avengers-2`);
    expect(syncPrompt([])).toBe(SYNC_PROMPT);
  });
});

describe('isSyncing', () => {
  test('a requested sync shows until any run changes after the request', () => {
    const requestedAt = '2026-01-01T00:00:10.000Z';
    expect(isSyncing({ syncRequestedAt: null, runs: [runAt('2026-01-01T00:00:00.000Z')] })).toBe(false);
    expect(isSyncing({ syncRequestedAt: requestedAt, runs: [runAt('2026-01-01T00:00:00.000Z'), runAt(requestedAt)] })).toBe(true);
    expect(isSyncing({ syncRequestedAt: requestedAt, runs: [runAt('2026-01-01T00:00:00.000Z'), runAt('2026-01-01T00:00:11.000Z')] })).toBe(false);
    expect(isSyncing({ syncRequestedAt: requestedAt, runs: [] })).toBe(true);
  });
});
