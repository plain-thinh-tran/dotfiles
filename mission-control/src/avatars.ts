import type { Agent } from './types';

export type AvatarKind = 'orchestrator' | 'opus' | 'sonnet' | 'haiku' | 'codex' | 'cursor' | 'other';

export const AVATAR_IDS: Record<AvatarKind, number> = {
  orchestrator: 4019167,
  opus: 2503200,
  sonnet: 7024072,
  haiku: 6750978,
  codex: 9238490,
  cursor: 4402889,
  other: 7023993,
};

export const ROLE_NAMES: Record<AvatarKind, string> = {
  orchestrator: 'Orchestrator',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  codex: 'Codex',
  cursor: 'Grok',
  other: 'Other',
};

export const ALL_AVATAR_IDS: number[] = [...new Set(Object.values(AVATAR_IDS))];

export function avatarKindOf(agent: Agent): AvatarKind {
  if (agent.role === 'orchestrator') return 'orchestrator';
  const model = agent.model.toLowerCase();
  if (agent.harness === 'codex') return 'codex';
  if (agent.harness === 'cursor' || model.includes('grok')) return 'cursor';
  if (agent.harness === 'claude' && model.includes('sonnet')) return 'sonnet';
  if (agent.harness === 'claude' && model.includes('haiku')) return 'haiku';
  if (agent.harness === 'claude' && model.includes('opus')) return 'opus';
  return 'other';
}

export function avatarSourceUrl(id: number): string {
  return `https://cdn-icons-png.magnific.com/256/${Math.floor(id / 1000)}/${id}.png`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function modelLabel(agent: Agent): string {
  const [, family, major, minor] = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(agent.model) ?? [];
  if (family !== undefined && major !== undefined && minor !== undefined) return `${capitalise(family)} ${major}.${minor}`;
  const [, version, variant] = /^gpt-([\d.]+)(?:-([a-z]+))?/.exec(agent.model) ?? [];
  if (version !== undefined) return variant !== undefined ? `GPT-${version} ${capitalise(variant)}` : `GPT-${version}`;
  const [, grok] = /grok-([\d.]+)/.exec(agent.model) ?? [];
  if (grok !== undefined) return `Grok ${grok}`;
  return agent.model !== '' ? agent.model : agent.name;
}
