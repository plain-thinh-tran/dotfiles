import type { ReactNode } from 'react';
import type { Agent } from '../src/types';

type Variant = 'opus' | 'sonnet' | 'haiku' | 'codex' | 'cursor' | 'other';

const COLORS: Record<Exclude<Variant, 'other'>, string> = {
  opus: '#D97757',
  sonnet: '#4F7CFF',
  haiku: '#14B8A6',
  codex: '#10A37F',
  cursor: '#7C3AED',
};

const INK = '#2b2233';
const ORCHESTRATOR_SCALE = 1.3;

function variantOf(agent: Agent): Variant {
  const model = agent.model.toLowerCase();
  if (agent.harness === 'codex') return 'codex';
  if (agent.harness === 'cursor' || model.includes('grok')) return 'cursor';
  if (agent.harness === 'claude' && model.includes('opus')) return 'opus';
  if (agent.harness === 'claude' && model.includes('sonnet')) return 'sonnet';
  if (agent.harness === 'claude' && model.includes('haiku')) return 'haiku';
  return 'other';
}

function hashHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function initialsOf(name: string): string {
  const parts = name.split(/[\s_-]+/).filter((part) => part !== '');
  const letters = parts.length > 1 ? parts.slice(0, 2).map((part) => part[0]) : [name.slice(0, 2)];
  return letters.join('').toUpperCase();
}

function Face({ ink, eye }: { ink: string; eye: string }) {
  return (
    <g>
      <circle cx="18.5" cy="25.5" r="2.1" fill={eye} />
      <circle cx="29.5" cy="25.5" r="2.1" fill={eye} />
      <circle cx="19.2" cy="24.8" r="0.7" fill="#fff" />
      <circle cx="30.2" cy="24.8" r="0.7" fill="#fff" />
      <ellipse cx="13.6" cy="30.5" rx="2.8" ry="1.7" fill="#ff8fa3" opacity="0.6" />
      <ellipse cx="34.4" cy="30.5" rx="2.8" ry="1.7" fill="#ff8fa3" opacity="0.6" />
      <path d="M20.5 31 Q24 34.6 27.5 31" stroke={ink} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </g>
  );
}

function Shine() {
  return <ellipse cx="17" cy="15.5" rx="6" ry="3" fill="#fff" opacity="0.2" transform="rotate(-25 17 15.5)" />;
}

function RoundHead({ fill }: { fill: string }) {
  return (
    <>
      <circle cx="24" cy="26" r="16" fill={fill} stroke="#fff" strokeWidth="2" />
      <Shine />
      <Face ink={INK} eye={INK} />
    </>
  );
}

function Crown() {
  return (
    <g>
      <path
        d="M15.5 11.5 L15 3.5 L20 7.6 L24 1.8 L28 7.6 L33 3.5 L32.5 11.5 Z"
        fill="#FFC933"
        stroke="#D99A00"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <rect x="15.5" y="9.2" width="17" height="3" rx="1.2" fill="#E8A800" />
      <circle cx="15" cy="3.2" r="1.3" fill="#fff" stroke="#D99A00" strokeWidth="0.6" />
      <circle cx="24" cy="1.9" r="1.4" fill="#FF5C6C" stroke="#D99A00" strokeWidth="0.6" />
      <circle cx="33" cy="3.2" r="1.3" fill="#fff" stroke="#D99A00" strokeWidth="0.6" />
    </g>
  );
}

function HardHat() {
  return (
    <g>
      <path d="M12.5 17 C12.5 5.5 35.5 5.5 35.5 17 Z" fill="#FFC83D" stroke="#fff" strokeWidth="1.2" />
      <rect x="22.4" y="6.4" width="3.2" height="10" rx="1" fill="#F5A800" />
      <rect x="9" y="15.6" width="30" height="3.6" rx="1.8" fill="#FFB400" stroke="#fff" strokeWidth="1" />
    </g>
  );
}

function Sprout() {
  return (
    <g>
      <path d="M24 11 Q24 6 25.5 3" stroke="#0F766E" strokeWidth="1.9" strokeLinecap="round" fill="none" />
      <ellipse cx="20" cy="4.6" rx="4.3" ry="2.3" fill="#5EEAD4" transform="rotate(-28 20 4.6)" />
      <ellipse cx="29.4" cy="3.2" rx="4.3" ry="2.3" fill="#2DD4BF" transform="rotate(28 29.4 3.2)" />
    </g>
  );
}

function Antenna() {
  return (
    <g>
      <line x1="24" y1="11" x2="24" y2="4.6" stroke="#0B7A5F" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="3.6" r="2.5" fill="#FDE68A" stroke="#0B7A5F" strokeWidth="1.2" />
    </g>
  );
}

function CatEars() {
  return (
    <g>
      <path d="M9.5 24 L10.5 5.5 L24 11.5 Z" fill="#7C3AED" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M38.5 24 L37.5 5.5 L24 11.5 Z" fill="#7C3AED" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13 18.5 L13.4 10.5 L19.5 13.2 Z" fill="#F9A8D4" />
      <path d="M35 18.5 L34.6 10.5 L28.5 13.2 Z" fill="#F9A8D4" />
    </g>
  );
}

function Whiskers() {
  return (
    <g stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.65">
      <line x1="6" y1="28" x2="11" y2="29" />
      <line x1="6.4" y1="32" x2="11" y2="31.2" />
      <line x1="42" y1="28" x2="37" y2="29" />
      <line x1="41.6" y1="32" x2="37" y2="31.2" />
    </g>
  );
}

function CodexHead() {
  return (
    <>
      <rect x="8" y="10" width="32" height="32" rx="11" fill={COLORS.codex} stroke="#fff" strokeWidth="2" />
      <rect x="12" y="16" width="24" height="20" rx="8" fill="#0A3D31" />
      <ellipse cx="17" cy="19.5" rx="4" ry="1.8" fill="#fff" opacity="0.18" transform="rotate(-20 17 19.5)" />
      <Face ink="#D9FFF1" eye="#D9FFF1" />
    </>
  );
}

function OtherHead({ agent }: { agent: Agent }) {
  const hue = hashHue(agent.id);
  return (
    <>
      <circle cx="24" cy="26" r="16" fill={`hsl(${hue} 62% 52%)`} stroke="#fff" strokeWidth="2" />
      <Shine />
      <text x="24" y="31" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
        {initialsOf(agent.name)}
      </text>
    </>
  );
}

function drawing(agent: Agent, variant: Variant, orchestrator: boolean): ReactNode {
  switch (variant) {
    case 'opus':
      return <RoundHead fill={COLORS.opus} />;
    case 'sonnet':
      return (
        <>
          <RoundHead fill={COLORS.sonnet} />
          {orchestrator ? null : <HardHat />}
        </>
      );
    case 'haiku':
      return (
        <>
          <RoundHead fill={COLORS.haiku} />
          {orchestrator ? null : <Sprout />}
        </>
      );
    case 'codex':
      return (
        <>
          {orchestrator ? null : <Antenna />}
          <CodexHead />
        </>
      );
    case 'cursor':
      return (
        <>
          <CatEars />
          <RoundHead fill={COLORS.cursor} />
          <Whiskers />
        </>
      );
    case 'other':
      return <OtherHead agent={agent} />;
  }
}

export function Avatar({ agent, size = 28 }: { agent: Agent; size?: number }) {
  const orchestrator = agent.role === 'orchestrator';
  const px = orchestrator ? Math.round(size * ORCHESTRATOR_SCALE) : size;
  const label = `${agent.name} · ${agent.model} · ${agent.role}`;
  return (
    <span className={orchestrator ? 'avatar avatar-orchestrator' : 'avatar'} title={label} style={{ width: px, height: px }}>
      <svg viewBox="0 0 48 48" width={px} height={px} aria-hidden="true">
        {orchestrator ? <circle cx="24" cy="26" r="19.6" fill="#FFF3C4" stroke="#F5B301" strokeWidth="2.6" /> : null}
        {drawing(agent, variantOf(agent), orchestrator)}
        {orchestrator ? <Crown /> : null}
      </svg>
    </span>
  );
}

export function AvatarStack({ agents, size = 24 }: { agents: Agent[]; size?: number }) {
  return (
    <span className="avatar-stack">
      {agents.map((agent) => (
        <Avatar key={agent.id} agent={agent} size={size} />
      ))}
    </span>
  );
}
