import type { Position, Todo } from './types';

export function voteCounts(positions: Position[]): number[] {
  const counts = new Map<string, number>();
  positions.forEach((position) => {
    if (position.optionId !== undefined) counts.set(position.optionId, (counts.get(position.optionId) ?? 0) + 1);
  });
  return [...counts.values()].sort((a, b) => b - a);
}

export function isSplit(positions: Position[]): boolean {
  return voteCounts(positions).length > 1;
}

export function councilAgrees(positions: Position[], recommendation: Todo['recommendation']): boolean {
  const first = positions[0]?.optionId;
  return (
    positions.length >= 2 &&
    first !== undefined &&
    recommendation?.optionId === first &&
    positions.every((position) => position.optionId === first)
  );
}
