import type { Agent, Position } from '../src/types';

const STANCE_WORDS: Record<string, string> = {
  agree: 'agreed',
  revise: 'refined the fix',
  disagree: 'disagreed',
  withdraw: 'withdrew',
};

const SEAT_BY_ID_PREFIX: Record<string, string> = { C: 'claude', X: 'codex', G: 'grok' };

export function stanceWord(stance: string): string {
  return STANCE_WORDS[stance] ?? stance;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function nameOf(agents: Agent[], id: string): string {
  return agents.find((agent) => agent.id === id)?.name ?? id;
}

function namesWhere(positions: Position[], agents: Agent[], stances: string[]): string[] {
  return positions.filter((position) => stances.includes(position.stance)).map((position) => nameOf(agents, position.agent));
}

export function consensusLine(positions: Position[], agents: Agent[]): string {
  const agreed = namesWhere(positions, agents, ['agree']);
  const refined = namesWhere(positions, agents, ['revise']);
  const rejected = namesWhere(positions, agents, ['disagree', 'withdraw']);
  const holders = [...agreed, ...refined];
  if (rejected.length === 0) {
    const parts = [
      agreed.length > 0 ? `Agreed by ${joinNames(agreed)}` : '',
      refined.length > 0 ? `${joinNames(refined)} refined the fix` : '',
    ].filter((part) => part !== '');
    return parts.join('; ');
  }
  if (holders.length === 0) return `Rejected by ${joinNames(rejected)}`;
  return `${joinNames(holders)} ${holders.length === 1 ? 'holds' : 'hold'} it; ${joinNames(rejected)} ${rejected.length === 1 ? 'rejects' : 'reject'} it`;
}

export function alsoRaisedLine(ids: string[], agents: Agent[]): string {
  const labelled = ids.map((id) => {
    const seat = SEAT_BY_ID_PREFIX[id.charAt(0)];
    return seat === undefined ? id : `${nameOf(agents, seat)} (${id})`;
  });
  return `Also raised independently by ${joinNames(labelled)}`;
}
