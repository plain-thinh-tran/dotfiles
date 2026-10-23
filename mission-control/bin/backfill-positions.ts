#!/usr/bin/env bun
import { alsoRaisedAs, latestTally, positionsOf } from '../src/prc';
import { readRun, withRunLock, writeRun } from '../src/store';

const contextDir = process.argv[2];
const runId = process.argv[3];
if (contextDir === undefined || runId === undefined) {
  console.error('usage: backfill-positions.ts <prod-ready-check context dir> <runId>');
  process.exit(1);
}

const tally = latestTally(contextDir);
const itemsById = new Map(tally.map((item) => [item.id, item]));
const raised = alsoRaisedAs(tally);

const result = await withRunLock(runId, () => {
  const run = readRun(runId);
  if (run === null) return null;
  const matched: string[] = [];
  const unmatched: string[] = [];
  run.todos.forEach((todo) => {
    const item = itemsById.get(todo.id);
    if (item === undefined) {
      unmatched.push(todo.id);
      return;
    }
    todo.positions = positionsOf(item);
    const others = raised.get(todo.id) ?? [];
    if (others.length > 0) todo.alsoRaisedAs = others;
    else delete todo.alsoRaisedAs;
    matched.push(todo.id);
  });
  writeRun(run);
  return { matched, unmatched };
});

if (result === null) {
  console.error(`run ${runId} not found`);
  process.exit(1);
}
console.log(`${runId}: set positions on ${result.matched.join(', ') || 'nothing'}${result.unmatched.length > 0 ? `; no tally item for ${result.unmatched.join(', ')}` : ''}`);
