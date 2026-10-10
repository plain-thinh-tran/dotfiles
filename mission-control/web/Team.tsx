import { ROLE_NAMES, avatarKindOf, modelLabel } from '../src/avatars';
import type { AvatarKind } from '../src/avatars';
import type { Agent, Thread } from '../src/types';
import { Avatar } from './Avatar';
import { relativeTime } from './Overview';

type StepEntry = Thread['steps'][number];

type Seat = { kind: AvatarKind; role: string; description: string; sample: Agent };

const SEATS: Seat[] = [
  {
    kind: 'orchestrator',
    role: ROLE_NAMES.orchestrator,
    description: 'Frames the work, chairs the council, decides',
    sample: { id: 'orchestrator', name: 'Orchestrator', role: 'orchestrator', harness: 'claude', model: 'claude-opus-5-5' },
  },
  {
    kind: 'opus',
    role: ROLE_NAMES.opus,
    description: 'Blind design and review seat',
    sample: { id: 'opus', name: 'Opus', role: 'council', harness: 'claude', model: 'claude-opus-5-5' },
  },
  {
    kind: 'sonnet',
    role: ROLE_NAMES.sonnet,
    description: 'Executes specced work packets',
    sample: { id: 'sonnet', name: 'Sonnet', role: 'worker', harness: 'claude', model: 'claude-sonnet-5-5' },
  },
  {
    kind: 'haiku',
    role: ROLE_NAMES.haiku,
    description: 'Read only code lookups',
    sample: { id: 'haiku', name: 'Haiku', role: 'scout', harness: 'claude', model: 'claude-haiku-5-5' },
  },
  {
    kind: 'codex',
    role: ROLE_NAMES.codex,
    description: 'Council member, proposes and attacks designs',
    sample: { id: 'codex', name: 'Codex', role: 'council', harness: 'codex', model: 'gpt-6-sol' },
  },
  {
    kind: 'cursor',
    role: ROLE_NAMES.cursor,
    description: 'Council member, reviews blind',
    sample: { id: 'cursor', name: 'Grok', role: 'council', harness: 'cursor', model: 'cursor-grok-4.6-medium' },
  },
  {
    kind: 'other',
    role: ROLE_NAMES.other,
    description: 'Unknown agent',
    sample: { id: 'other', name: 'Other', role: 'reviewer', harness: 'other', model: '' },
  },
];

const ORCHESTRATOR_SAMPLE = SEATS[0]?.sample as Agent;

const STRIP_SLOTS = 6;

function ownerOf(step: StepEntry, thread: Thread): string | null {
  return step.agent ?? thread.agents.find((agent) => agent.role === 'orchestrator')?.id ?? null;
}

function StepStrip({ steps, currentAt }: { steps: StepEntry[]; currentAt: string | null }) {
  const recent = steps.slice(-STRIP_SLOTS);
  return (
    <span className="strip" aria-hidden="true">
      {Array.from({ length: STRIP_SLOTS }, (_, index) => {
        const step = recent[index];
        if (step === undefined) return <i key={index} />;
        return <i key={index} className={step.at === currentAt ? 'a' : 'w'} />;
      })}
    </span>
  );
}

function AgentRow({ agent, thread, now }: { agent: Agent; thread: Thread; now: number }) {
  const mine = thread.steps.filter((step) => ownerOf(step, thread) === agent.id);
  const last = mine[mine.length - 1];
  const owns = thread.live === 'working' && thread.step !== null && ownerOf(thread.step, thread) === agent.id;
  return (
    <div className="team-row" data-here="true">
      <Avatar agent={agent} size={36} />
      <div className="team-body">
        <div className="team-role">
          <span>
            {ROLE_NAMES[avatarKindOf(agent)]} · {modelLabel(agent)}
          </span>
        </div>
        {owns && thread.step !== null ? <div className="team-now">Now: {thread.step.text}</div> : null}
        {!owns && last !== undefined ? (
          <div className="team-last">
            {last.text} · {relativeTime(last.at, now)}
          </div>
        ) : null}
      </div>
      <StepStrip steps={mine} currentAt={owns && thread.step !== null ? thread.step.at : null} />
    </div>
  );
}

export function TeamPane({ thread, now, onClose }: { thread: Thread | null; now: number; onClose: () => void }) {
  const agents = thread?.agents ?? [];
  const presentKinds = new Set(agents.map(avatarKindOf));
  return (
    <section className="team">
      <header className="team-header">
        <h2>Avengers</h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="team-scroll">
        {thread !== null ? agents.map((agent) => <AgentRow key={agent.id} agent={agent} thread={thread} now={now} />) : null}
        {SEATS.filter((seat) => !presentKinds.has(seat.kind)).map((seat) => (
          <div key={seat.kind} className="team-row" data-here="false">
            <Avatar agent={seat.sample} size={36} title={seat.role} />
            <div className="team-body">
              <div className="team-role">
                <span>{seat.role}</span>
              </div>
              <div className="team-desc">{seat.description}</div>
            </div>
          </div>
        ))}
        <div className="team-credit">Icons by Freepik</div>
      </div>
    </section>
  );
}

export function Dock(props: {
  showArchived: boolean;
  online: boolean;
  teamOpen: boolean;
  onToggleArchived: () => void;
  onToggleTeam: () => void;
}) {
  return (
    <footer className="dock">
      <div className="dock-left">
        <button
          className="icon-btn"
          data-active={props.showArchived}
          title={props.showArchived ? 'Hide archived' : 'Show archived'}
          aria-label={props.showArchived ? 'Hide archived' : 'Show archived'}
          onClick={props.onToggleArchived}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 3.5 H14 V6.5 H2 Z M3 6.5 V12.5 Q3 13 3.5 13 H12.5 Q13 13 13 12.5 V6.5 M6.5 9.2 H9.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <a
          className="icon-btn"
          href="https://www.magnific.com/icons/character"
          target="_blank"
          rel="noopener noreferrer"
          title="Icons by Freepik"
          aria-label="Icons by Freepik"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 7.2 V11 M8 5 V5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
      </div>
      <button className="dock-avatar" data-open={props.teamOpen} aria-label="Avengers" aria-expanded={props.teamOpen} onClick={props.onToggleTeam}>
        <Avatar agent={ORCHESTRATOR_SAMPLE} size={28} title="Avengers" />
        <span className="status-dot" data-online={props.online} />
      </button>
    </footer>
  );
}
