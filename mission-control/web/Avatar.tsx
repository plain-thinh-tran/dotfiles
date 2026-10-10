import { useId, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { AVATAR_IDS, avatarKindOf } from '../src/avatars';
import type { AvatarKind } from '../src/avatars';
import type { Agent } from '../src/types';

const SKIN = '#F2C9A0';
const INK = '#2b1d1a';

function starPoints(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.42;
  return Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

function Eyes({ y }: { y: number }) {
  return (
    <g fill={INK}>
      <circle cx="12.7" cy={y} r="1.3" />
      <circle cx="19.3" cy={y} r="1.3" />
      <circle cx="13.1" cy={y - 0.4} r="0.4" fill="#fff" />
      <circle cx="19.7" cy={y - 0.4} r="0.4" fill="#fff" />
    </g>
  );
}

function Smile({ y }: { y: number }) {
  return <path d={`M14.2 ${y} Q16 ${y + 1.9} 17.8 ${y}`} stroke={INK} strokeWidth="1.1" strokeLinecap="round" fill="none" />;
}

function Blush({ y }: { y: number }) {
  return (
    <g fill="#ff8fa3" opacity="0.5">
      <ellipse cx="10.6" cy={y} rx="1.6" ry="1" />
      <ellipse cx="21.4" cy={y} rx="1.6" ry="1" />
    </g>
  );
}

function IronMan() {
  return (
    <g>
      <circle cx="16" cy="17" r="11.5" fill="#C8102E" stroke="#7d0a1d" strokeWidth="0.8" />
      <path
        d="M9.6 13.6 Q16 9.6 22.4 13.6 L21.9 21 Q21 26.4 16 27.6 Q11 26.4 10.1 21 Z"
        fill="#F2C14E"
        stroke="#B8892A"
        strokeWidth="0.7"
      />
      <g fill="#7FE7FF" opacity="0.35">
        <ellipse cx="12.8" cy="17" rx="3.6" ry="2.1" />
        <ellipse cx="19.2" cy="17" rx="3.6" ry="2.1" />
      </g>
      <path d="M10.6 15.7 L14.9 16.5 L14.7 18.2 L10.9 17.5 Z" fill="#7FE7FF" />
      <path d="M21.4 15.7 L17.1 16.5 L17.3 18.2 L21.1 17.5 Z" fill="#7FE7FF" />
      <path d="M16 18 L16 21.6 M13.8 23.6 L18.2 23.6" stroke="#B8892A" strokeWidth="0.8" strokeLinecap="round" />
    </g>
  );
}

function CaptainAmerica() {
  return (
    <g>
      <g stroke="#fff" strokeWidth="1.2" strokeLinecap="round">
        <path d="M3.6 13.6 L8 12 M4.4 16 L8.2 14.6" />
        <path d="M28.4 13.6 L24 12 M27.6 16 L23.8 14.6" />
      </g>
      <circle cx="16" cy="17" r="11.5" fill="#1F4E9C" stroke="#143468" strokeWidth="0.8" />
      <path d="M9 18.6 Q9 15.4 16 15.4 Q23 15.4 23 18.6 L23 21.4 Q23 27.4 16 28 Q9 27.4 9 21.4 Z" fill={SKIN} />
      <polygon points={starPoints(16, 11, 2.7)} fill="#fff" />
      <Eyes y={19.4} />
      <Blush y={22} />
      <Smile y={23.6} />
    </g>
  );
}

function BlackWidow() {
  return (
    <g>
      <path
        d="M4.6 18 Q4 5.5 16 5.5 Q28 5.5 27.4 18 L27.4 24.5 Q27.4 26.4 25 26.4 L7 26.4 Q4.6 26.4 4.6 24.5 Z"
        fill="#C0392B"
        stroke="#8c2418"
        strokeWidth="0.8"
      />
      <ellipse cx="16" cy="18" rx="7.8" ry="8.2" fill={SKIN} />
      <path d="M8 15.6 Q9.4 8.6 16 8.4 Q22.6 8.6 24 15.6 Q19.4 12.6 16 12.4 Q12.6 12.6 8 15.6 Z" fill="#C0392B" />
      <path d="M8.2 25.4 Q16 29.6 23.8 25.4 L25 29.8 Q16 32 7 29.8 Z" fill="#26262c" stroke="#4a4a54" strokeWidth="0.7" />
      <Eyes y={18.8} />
      <Blush y={21.4} />
      <Smile y={22.6} />
    </g>
  );
}

function Thor() {
  return (
    <g>
      <path d="M3.4 31 L7.6 21.6 L12.4 26.4 L10.8 31 Z" fill="#C8102E" />
      <path d="M28.6 31 L24.4 21.6 L19.6 26.4 L21.2 31 Z" fill="#C8102E" />
      <path
        d="M5.6 17 Q5.6 5.8 16 5.8 Q26.4 5.8 26.4 17 L27 26.6 L21.4 23 L10.6 23 L5 26.6 Z"
        fill="#F4D35E"
        stroke="#c9a52e"
        strokeWidth="0.7"
      />
      <ellipse cx="16" cy="18.6" rx="7.2" ry="7.4" fill={SKIN} />
      <g fill="#EEF2F6" stroke="#8b95a1" strokeWidth="0.7" strokeLinejoin="round">
        <path d="M8.6 10.4 Q4.4 9.4 1.6 5.2 Q2.2 11.4 8.4 13.2 Z" />
        <path d="M23.4 10.4 Q27.6 9.4 30.4 5.2 Q29.8 11.4 23.6 13.2 Z" />
      </g>
      <path
        d="M8.4 13.6 Q8.4 5.4 16 5.4 Q23.6 5.4 23.6 13.6 Q16 11 8.4 13.6 Z"
        fill="#C9D1D9"
        stroke="#8b95a1"
        strokeWidth="0.8"
      />
      <Eyes y={19.4} />
      <Smile y={23.2} />
    </g>
  );
}

function Hulk() {
  return (
    <g>
      <circle cx="16" cy="17.5" r="11.5" fill="#4CAF50" stroke="#2f7d32" strokeWidth="0.8" />
      <path
        d="M6.6 12 L8.2 5.6 L11.4 9.2 L13 3.8 L16 8.4 L19 3.6 L20.6 9 L23.8 5.4 L25.4 12 Q16 7.6 6.6 12 Z"
        fill="#17171a"
        strokeLinejoin="round"
      />
      <path d="M9.6 13.8 L14.6 15.6 M22.4 13.8 L17.4 15.6" stroke="#17171a" strokeWidth="1.7" strokeLinecap="round" />
      <Eyes y={18} />
      <ellipse cx="16" cy="22.4" rx="4.2" ry="1.4" fill="#3d8f41" />
      <Smile y={22.4} />
    </g>
  );
}

function BlackPanther() {
  return (
    <g>
      <path d="M6.2 14 L5.4 2.8 L14 7.6 Z" fill="#1B1B1F" stroke="#8B5CF6" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M25.8 14 L26.6 2.8 L18 7.6 Z" fill="#1B1B1F" stroke="#8B5CF6" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="16" cy="17.5" r="11.5" fill="#1B1B1F" stroke="#8B5CF6" strokeWidth="1.5" />
      <path d="M16 7.4 L16 12.4 M9.4 23 L13.6 24.6 M22.6 23 L18.4 24.6" stroke="#8B5CF6" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M9.4 18.4 Q12.4 14.8 15 18 Q12.2 19.4 9.4 18.4 Z" fill="#8B5CF6" />
      <path d="M22.6 18.4 Q19.6 14.8 17 18 Q19.8 19.4 22.6 18.4 Z" fill="#8B5CF6" />
      <path d="M14.6 21.6 L16 22.8 L17.4 21.6" stroke="#8B5CF6" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </g>
  );
}

function SpiderMan() {
  const clipId = useId();
  return (
    <g>
      <clipPath id={clipId}>
        <circle cx="16" cy="17" r="11.5" />
      </clipPath>
      <circle cx="16" cy="17" r="11.5" fill="#D32F2F" />
      <g clipPath={`url(#${clipId})`} stroke="#4a0d0d" strokeWidth="0.55" fill="none" opacity="0.85">
        <path d="M16 5 L16 29 M4 17 L28 17 M7.5 8.5 L24.5 25.5 M24.5 8.5 L7.5 25.5" />
        <path d="M10.4 8 Q16 11.5 21.6 8 M7 12 Q16 17 25 12 M7 23 Q16 19 25 23 M10.4 27 Q16 23.5 21.6 27" />
      </g>
      <circle cx="16" cy="17" r="11.5" fill="none" stroke="#8c1717" strokeWidth="0.8" />
      <path d="M8.2 16.2 Q12 12.6 15.2 17.4 Q11.6 20.8 8.2 16.2 Z" fill="#fff" stroke="#17171a" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M23.8 16.2 Q20 12.6 16.8 17.4 Q20.4 20.8 23.8 16.2 Z" fill="#fff" stroke="#17171a" strokeWidth="1.1" strokeLinejoin="round" />
    </g>
  );
}

const DRAWINGS: Record<AvatarKind, () => ReactElement> = {
  orchestrator: IronMan,
  sonnet: CaptainAmerica,
  haiku: BlackWidow,
  opus: Thor,
  codex: Hulk,
  cursor: BlackPanther,
  other: SpiderMan,
};

function frameStyle(agent: Agent): CSSProperties {
  const model = agent.model.toLowerCase();
  if (agent.harness === 'cursor' || model.includes('grok')) {
    return { background: '#0b0b0d', border: '1px solid #3a3a42' };
  }
  if (agent.harness === 'codex') return { background: 'rgba(16,163,127,0.18)' };
  if (agent.harness === 'claude') return { background: 'rgba(217,119,87,0.18)' };
  return { background: '#232328' };
}

function FallbackDrawing({ kind, px }: { kind: AvatarKind; px: number }) {
  const Drawing = DRAWINGS[kind];
  return (
    <svg viewBox="0 0 32 32" width={px} height={px} aria-hidden="true">
      <Drawing />
    </svg>
  );
}

export function Avatar({ agent, size = 28, title }: { agent: Agent; size?: number; title?: string }) {
  const [failed, setFailed] = useState(false);
  const kind = avatarKindOf(agent);
  const label = title ?? `${agent.name} · ${agent.role}`;
  return (
    <span className="avatar" title={label} style={{ width: size, height: size }}>
      {failed ? (
        <FallbackDrawing kind={kind} px={size} />
      ) : (
        <span className="avatar-frame" style={frameStyle(agent)}>
          <img src={`/avatars/${AVATAR_IDS[kind]}.png`} alt="" onError={() => setFailed(true)} />
        </span>
      )}
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
