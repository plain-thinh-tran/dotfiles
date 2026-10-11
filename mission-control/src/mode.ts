import type { Run, RunMode } from './types';

const MODES: RunMode[] = ['build', 'review', 'self-check'];

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === 'string' && MODES.includes(value as RunMode);
}

export function modeOf(run: Pick<Run, 'mode' | 'skill'>): RunMode {
  if (run.mode !== undefined) return run.mode;
  return run.skill === 'prod-ready-check' ? 'review' : 'build';
}
