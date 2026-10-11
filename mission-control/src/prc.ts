import { basename, dirname, resolve } from 'node:path';
import { extractDiffs } from './diffs';
import type { RunMode } from './types';

export type SeatId = 'claude' | 'codex' | 'grok';

export type SeatPosition = {
  stance: 'agree' | 'revise' | 'disagree' | 'withdraw';
  severity: string;
  reason: string;
  evidence: string;
  revised_fix: string | null;
};

export type TallyItem = {
  id: string;
  owner: SeatId;
  severity: string;
  title: string;
  location: string;
  failure: string;
  fix: string;
  evidence?: string;
  confidence?: string;
  status: 'agreed' | 'dropped' | 'contested';
} & Partial<Record<SeatId, SeatPosition>>;

const SEATS: SeatId[] = ['claude', 'codex', 'grok'];

const REF_PREFIX = /(^|[\s,;(])(?:pr-\d+|origin\/[^:\s,;()]+):/g;

export function stripRefs(text: string): string {
  return text.replace(REF_PREFIX, '$1');
}

export function consensusSeverity(item: TallyItem): string {
  const votes = new Map<string, number>();
  SEATS.forEach((seat) => {
    const position = item[seat];
    if (position !== undefined && (position.stance === 'agree' || position.stance === 'revise')) {
      votes.set(position.severity, (votes.get(position.severity) ?? 0) + 1);
    }
  });
  if (votes.size === 0) return item.severity;
  const top = Math.max(...votes.values());
  const leaders = [...votes].filter(([, count]) => count === top).map(([severity]) => severity);
  return leaders.includes(item.severity) ? item.severity : (leaders[0] as string);
}

export function runIdFor(url: string | undefined, contextDir: string, number?: number): string {
  const match = url === undefined ? null : /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (match !== null) return `prc-${match[1]}-${match[2]}`;
  const resolved = resolve(contextDir);
  const pr = number ?? Number(basename(resolved).replace('pr-', ''));
  return `prc-${basename(dirname(dirname(dirname(dirname(resolved)))))}-${pr}`;
}

function positionsOf(item: TallyItem) {
  return SEATS.filter((seat) => item[seat] !== undefined).map((seat) => {
    const position = item[seat] as SeatPosition;
    return {
      agent: seat,
      stance: position.stance,
      summary: `${position.stance} · ${position.severity}`,
      reason: position.reason,
      evidence: stripRefs(position.evidence)
        .split(/;\s+/)
        .filter((entry) => entry !== ''),
    };
  });
}

export function findingTodo(item: TallyItem, patch: string, prUrl?: string) {
  return {
    id: item.id,
    kind: 'finding',
    category: 'needs-you',
    title: item.title,
    question: `${item.failure}\n\nFix: ${item.fix}`,
    severity: consensusSeverity(item),
    ...(item.evidence !== undefined && item.evidence !== '' ? { verification: stripRefs(item.evidence) } : {}),
    positions: item.status === 'contested' ? positionsOf(item) : [],
    tradeoffs: [],
    caveats: item.confidence === 'low' ? ['Raised with low confidence'] : [],
    evidence: [{ ref: stripRefs(item.location) }],
    links: prUrl === undefined || prUrl === '' ? [] : [{ label: 'Pull request', url: prUrl }],
    diffs: extractDiffs(patch, stripRefs(item.location)),
    draftComment: '',
    suggestedQuestions: [],
  };
}

export function findingTodos(tally: TallyItem[], patch: string, prUrl?: string) {
  const contested = tally.filter((item) => item.status === 'contested');
  const agreed = tally.filter((item) => item.status === 'agreed');
  return [...contested, ...agreed].map((item) => findingTodo(item, patch, prUrl));
}

export function modeFor(authorLogin: string | undefined, thinhLogin: string | null): RunMode {
  return authorLogin !== undefined && thinhLogin !== null && authorLogin === thinhLogin ? 'self-check' : 'review';
}

export function resolveLogin(env: Record<string, string | undefined>, lookup: () => string | null): string | null {
  const configured = env.MC_GH_LOGIN;
  if (configured !== undefined && configured !== '') return configured;
  return lookup();
}
