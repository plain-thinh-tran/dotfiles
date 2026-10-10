#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

type SeatId = 'claude' | 'codex' | 'grok';

type SeatPosition = {
  stance: 'agree' | 'revise' | 'disagree' | 'withdraw';
  severity: string;
  reason: string;
  evidence: string;
  revised_fix: string | null;
};

type TallyItem = {
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

const KEY_SEVERITIES = new Set(['breaking', 'regression']);
const SEATS: SeatId[] = ['claude', 'codex', 'grok'];

const contextDir = process.argv[2];
if (contextDir === undefined) {
  console.error('usage: prc-to-mc.ts <prod-ready-check context dir>');
  process.exit(1);
}

function latestTally(dir: string): TallyItem[] {
  const rounds = readdirSync(join(dir, 'debate'))
    .map((f) => /^tally-(\d+)\.json$/.exec(f))
    .filter((m) => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a);
  if (rounds.length === 0) throw new Error(`no tally in ${dir}/debate`);
  return JSON.parse(readFileSync(join(dir, 'debate', `tally-${rounds[0]}.json`), 'utf8'));
}

function isReal(position: SeatPosition | undefined): boolean {
  return position !== undefined && (position.stance === 'agree' || position.stance === 'revise');
}

function contestedOption(p: SeatPosition): string {
  if (p.stance === 'agree') return 'real';
  if (p.stance === 'revise') return 'later';
  return 'not-real';
}

function approvalOption(p: SeatPosition): string {
  return isReal(p) ? 'approve' : 'reject';
}

function seatPositions(item: TallyItem): SeatPosition[] {
  return SEATS.map((s) => item[s]).filter((p) => p !== undefined);
}

function positions(item: TallyItem, optionOf: (p: SeatPosition) => string) {
  return SEATS.filter((s) => item[s] !== undefined).map((seat) => {
    const p = item[seat] as SeatPosition;
    return {
      agent: seat,
      stance: p.stance,
      optionId: optionOf(p),
      summary: `${p.stance} · ${p.severity}`,
      reason: p.reason,
      evidence: p.evidence.split(/;\s+/).filter((e) => e !== ''),
    };
  });
}

function contestedTodo(item: TallyItem) {
  const chair = item.claude;
  const revisedFix = seatPositions(item).find((p) => p.stance === 'revise' && p.revised_fix !== null)?.revised_fix;
  const options = [
    { id: 'real', label: 'Real: fix it in this PR', description: item.fix },
    { id: 'later', label: 'Real, but follow up separately', ...(revisedFix !== undefined && revisedFix !== null ? { description: revisedFix } : {}) },
    { id: 'not-real', label: 'Not real: drop it' },
  ];
  return {
    id: item.id,
    kind: 'decision',
    category: 'needs-you',
    title: item.title,
    question: `${item.severity} at ${item.location}\n\n${item.failure}`,
    recommendation:
      chair === undefined
        ? null
        : { by: 'claude', optionId: contestedOption(chair), summary: chair.reason },
    options,
    positions: positions(item, contestedOption),
    tradeoffs: [],
    caveats: item.confidence === 'low' ? ['Raised with low confidence'] : [],
    evidence: [{ ref: item.location }, ...(item.evidence !== undefined ? [{ ref: item.evidence }] : [])],
    links: [],
  };
}

function agreedTodo(item: TallyItem) {
  return {
    id: item.id,
    kind: 'approval',
    category: 'key-decision',
    title: item.title,
    question: `${item.severity} at ${item.location}\n\n${item.failure}\n\nFix: ${item.fix}`,
    recommendation: { by: 'claude', optionId: 'approve', summary: `All three reviewers agree this is ${item.severity}. Fix: ${item.fix}` },
    options: [],
    positions: positions(item, approvalOption),
    tradeoffs: [],
    caveats: [],
    evidence: [{ ref: item.location }, ...(item.evidence !== undefined ? [{ ref: item.evidence }] : [])],
    links: [],
  };
}

const tally = latestTally(contextDir);
const metaPath = join(contextDir, 'meta.json');
const meta: { number?: number; title?: string; url?: string } = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const pr = meta.number ?? Number(basename(contextDir).replace('pr-', ''));
const repo = basename(dirname(dirname(dirname(dirname(contextDir)))));

const todos = [
  ...tally.filter((i) => i.status === 'contested').map(contestedTodo),
  ...tally.filter((i) => i.status === 'agreed' && KEY_SEVERITIES.has(i.severity)).map(agreedTodo),
];

console.log(
  JSON.stringify(
    {
      runId: `prc-${repo}-${pr}`,
      skill: 'prod-ready-check',
      title: `PR #${pr} ${meta.title ?? ''}`.trim(),
      agents: [
        { id: 'claude', name: 'Claude', role: 'orchestrator', harness: 'claude', model: 'claude-opus-5-5' },
        { id: 'codex', name: 'Codex Sol', role: 'reviewer', harness: 'codex', model: process.env.CODEX_MODEL ?? 'gpt-6-sol' },
        { id: 'grok', name: 'Grok 4.6', role: 'reviewer', harness: 'cursor', model: process.env.GROK_MODEL ?? 'cursor-grok-4.6-medium' },
      ],
      todos,
    },
    null,
    2
  )
);
