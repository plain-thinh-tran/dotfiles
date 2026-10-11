import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { isSplit } from '../src/council';
import {
  QUESTION_PATIENCE_MS,
  chosenLabel,
  deliverableQuestionCount,
  isAwaitingPickup,
  isReadyToSubmit,
  latestThinhMessage,
  optionsFor,
} from '../src/prompt';
import type { Agent, LiveState, Option, Run, RunMode, RunPr, Thread, Todo, TodoState } from '../src/types';
import { Avatar, AvatarStack } from './Avatar';
import { unseenCount, useNewTodos, usePresence } from './activity';
import { Conversation } from './Conversation';
import { Diff } from './Diff';
import { FindingPane } from './Finding';
import { History } from './History';
import { prefersReducedMotion, useTypewriter } from './motion';
import { ModeIcon, MODE_TITLE, ModeTag } from './ModeTag';
import { Overview } from './Overview';
import { Palette } from './Palette';
import type { PaletteItem } from './Palette';
import { Snackbar } from './Snackbar';
import type { SnackState } from './Snackbar';
import { Dock, TeamPane } from './Team';

export type Tab = 'open' | 'progress' | 'all';
type View = 'overview' | 'decision';
type Draft = { optionId: string | null; text: string };
type Entry = { run: Run; todo: Todo };
type Busy = { kind: 'save' | 'accept' | 'ask'; status: 'saving' | 'saved' };
type Undo = () => Promise<string | null>;
type Ghost = { entry: Entry; index: number };

const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'progress', label: 'In progress' },
  { id: 'all', label: 'All' },
];

const SECTION_LABEL: Record<Tab, string> = {
  open: 'Needs you',
  progress: 'In progress',
  all: 'All',
};

const OPEN_LABEL: Record<RunMode, string> = {
  build: 'Needs you',
  review: 'To review',
  'self-check': 'To fix',
};

function sectionLabel(mode: RunMode, tab: Tab, finding: boolean): string {
  if (tab === 'open') return finding && mode === 'build' ? 'To review' : OPEN_LABEL[mode];
  return finding ? FINDING_LABEL[tab] : SECTION_LABEL[tab];
}

const FINDING_LABEL: Record<Tab, string> = {
  open: 'To review',
  progress: 'In progress',
  all: 'Findings',
};

const STATE_LABEL: Record<TodoState, string> = {
  open: 'Open',
  answered: 'Answered',
  submitted: 'Submitted',
  picked_up: 'Picked up',
  done: 'Done',
  dismissed: 'Dismissed',
  understood: 'Understood',
  commented: 'Commented',
  dropped: 'Dropped',
};

const LIVE_LABEL: Record<LiveState, string> = {
  working: 'working',
  waiting_on_you: 'waiting on you',
  idle: 'idle',
  dead: 'dead',
  error: 'error',
};

const LIFECYCLE_STAGES = ['Open', 'Answered', 'Sent', 'Picked up', 'Done'];
const LIFECYCLE_INDEX: Record<TodoState, number> = {
  open: 0,
  answered: 1,
  submitted: 2,
  picked_up: 3,
  done: 4,
  dismissed: -1,
  understood: -1,
  commented: 4,
  dropped: -1,
};
const CONFIRM_MS = 2500;
const SNACK_MS = 5000;
const LEAVE_MS = 250;
const GLOW_MS = 600;
const SAVED_MS = 1200;
const COUNCIL_TOOLTIP = 'Council pick, override before Submit';
const FLASH_MS = 1800;
const LOCATION_LINE = /^[\w-]+ at \S+/;

function useThreads(showArchived: boolean): Thread[] | null {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  useEffect(() => {
    const source = new EventSource(`/api/events?archived=${showArchived ? 1 : 0}`);
    source.addEventListener('threads', (event) => {
      setThreads(JSON.parse((event as MessageEvent<string>).data) as Thread[]);
    });
    return () => source.close();
  }, [showArchived]);
  return threads;
}

const NOW_TICK_MS = 30000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

async function postJson(path: string, body?: unknown): Promise<Response> {
  return await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function todoKey(entry: Entry): string {
  return `${entry.run.runId}/${entry.todo.id}`;
}

function todoPath(entry: Entry): string {
  return `/api/runs/${encodeURIComponent(entry.run.runId)}/todos/${encodeURIComponent(entry.todo.id)}`;
}

function matchesTab(todo: Todo, tab: Tab): boolean {
  return tab === 'all' || tabOf(todo) === tab;
}

function entriesOf(thread: Thread, tab: Tab): Entry[] {
  const all = thread.runs.flatMap((run) => run.todos.filter((todo) => matchesTab(todo, tab)).map((todo) => ({ run, todo })));
  return [...all.filter(isNeedsYou), ...all.filter((entry) => !isNeedsYou(entry))];
}

function isNeedsYou(entry: Entry): boolean {
  return entry.todo.category === 'needs-you';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function submitLabel(answers: number, questions: number): string {
  if (answers === 0 && questions === 0) return 'Nothing to submit';
  if (answers === 0) return `Send ${plural(questions, 'question')}`;
  if (questions === 0) return `Submit ${answers}`;
  return `Submit ${answers} + ${plural(questions, 'question')}`;
}

function sentSummary(answers: number, questions: number): string {
  const parts = [answers > 0 ? plural(answers, 'answer') : null, questions > 0 ? plural(questions, 'question') : null];
  return parts.filter((part): part is string => part !== null).join(' and ');
}

function tabOf(todo: Todo): Tab {
  if (todo.state === 'open' || isReadyToSubmit(todo)) return 'open';
  if (isAwaitingPickup(todo) || todo.state === 'picked_up') return 'progress';
  return 'all';
}

function useLeaving(entries: Entry[], allEntries: Entry[], scope: string): { ghosts: Ghost[]; glowTab: Tab | null } {
  const previous = useRef({ scope, entries });
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [glowTab, setGlowTab] = useState<Tab | null>(null);
  const signature = entries.map((e) => `${todoKey(e)}:${e.todo.state}`).join('|');
  useEffect(() => {
    const before = previous.current;
    previous.current = { scope, entries };
    if (before.scope !== scope || prefersReducedMotion()) return;
    const current = new Set(entries.map(todoKey));
    const removed = before.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => !current.has(todoKey(entry)));
    if (removed.length === 0) return;
    setGhosts((existing) => [...existing, ...removed]);
    setTimeout(() => setGhosts((existing) => existing.filter((g) => !removed.includes(g))), LEAVE_MS);
    const moved = allEntries.find((e) => todoKey(e) === todoKey((removed[0] as Ghost).entry));
    if (moved === undefined) return;
    setGlowTab(tabOf(moved.todo));
    setTimeout(() => setGlowTab(null), GLOW_MS);
  }, [signature, scope]);
  return { ghosts, glowTab };
}

function useCouncilOpen(sessionId: string): [boolean, () => void] {
  const key = `mc-council-open:${sessionId}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) === '1');
  useEffect(() => {
    setOpen(localStorage.getItem(key) === '1');
  }, [key]);
  function toggle(): void {
    const next = !open;
    localStorage.setItem(key, next ? '1' : '0');
    setOpen(next);
  }
  return [open, toggle];
}

function initialDraft(todo: Todo): Draft {
  if (todo.kind === 'finding') return { optionId: null, text: todo.answer?.text ?? todo.draftComment ?? '' };
  return { optionId: todo.answer?.optionId ?? null, text: todo.answer?.text ?? '' };
}

function isEditable(todo: Todo): boolean {
  return todo.state === 'open' || todo.state === 'answered';
}

function canSave(draft: Draft): boolean {
  return draft.optionId !== null || draft.text.trim() !== '';
}

function agentOf(agents: Agent[], id: string): Agent {
  return agents.find((agent) => agent.id === id) ?? { id, name: id, role: 'council', harness: 'other', model: '' };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
}

function Lifecycle({ state }: { state: TodoState }) {
  const current = LIFECYCLE_INDEX[state];
  if (current === -1) {
    return (
      <div className="lifecycle">
        <div className="seg">
          {LIFECYCLE_STAGES.map((stage) => (
            <i key={stage} />
          ))}
        </div>
        <div className="seglabels">
          <span>Dismissed</span>
        </div>
      </div>
    );
  }
  const finished = current === LIFECYCLE_STAGES.length - 1;
  return (
    <div className="lifecycle" aria-label={`Stage: ${LIFECYCLE_STAGES[current]}`}>
      <div className="seg">
        {LIFECYCLE_STAGES.map((stage, index) => (
          <i key={stage} className={index < current || finished ? 'on' : index === current ? 'now' : undefined} />
        ))}
      </div>
      <div className="seglabels">
        {LIFECYCLE_STAGES.map((stage, index) => (
          <span key={stage} data-current={index === current} data-finished={finished}>
            {stage}
          </span>
        ))}
      </div>
    </div>
  );
}

function SubmitConfirm({ name }: { name: string }) {
  return (
    <div className="submit-confirm">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="confirm-circle" cx="24" cy="24" r="21" />
        <path className="confirm-tick" d="M15 24.5 L21.5 31 L33 18" />
      </svg>
      <div>
        <b>Sent to {name}</b>
        <div className="muted">The agent is waking up</div>
      </div>
    </div>
  );
}

function StateIcon({ state }: { state: TodoState }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-label': STATE_LABEL[state] } as const;
  switch (state) {
    case 'open':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#8b8b94" strokeWidth="1.5" />
        </svg>
      );
    case 'answered':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#4f8cff" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="3" fill="#4f8cff" />
        </svg>
      );
    case 'submitted':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#f5a524" strokeWidth="1.5" />
          <path d="M8 4.8 V8 L10 9.4" stroke="#f5a524" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'picked_up':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#a371f7" strokeWidth="1.5" />
          <path d="M5.2 8 H10.4 M8.4 5.8 L10.6 8 L8.4 10.2" stroke="#a371f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'done':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="7" fill="#3fb950" />
          <path d="M5 8.2 L7.1 10.3 L11 6" stroke="#0b0b0d" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'understood':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#3fb950" strokeWidth="1.5" />
          <path d="M5.3 8.2 L7.2 10 L10.8 6.2" stroke="#3fb950" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'commented':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <path d="M2.5 3.5 H13.5 V10.5 H8.5 L5.5 13 V10.5 H2.5 Z" fill="#3fb950" stroke="#3fb950" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'dropped':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#5c5c66" strokeWidth="1.5" />
          <path d="M5.8 5.8 L10.2 10.2 M10.2 5.8 L5.8 10.2" stroke="#5c5c66" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'dismissed':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#5c5c66" strokeWidth="1.5" />
          <path d="M5.4 8 H10.6" stroke="#5c5c66" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

function LiveDot({ state }: { state: LiveState }) {
  return <span className={`dot dot-${state}`} title={LIVE_LABEL[state]} />;
}

function LiveMark({ state }: { state: LiveState }) {
  if (state !== 'working') return <LiveDot state={state} />;
  return (
    <span className="eq" title={LIVE_LABEL[state]}>
      <i />
      <i />
      <i />
    </span>
  );
}

function StepLine({ text }: { text: string }) {
  const { shown, typing } = useTypewriter(text);
  return (
    <>
      {shown}
      {typing ? <i className="caret" /> : null}
    </>
  );
}

function Chip({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  return (
    <span className={`chip ${className}`} title={title}>
      {children}
    </span>
  );
}

function ClampText({ text, lines, className }: { text: string; lines: number; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
  }, [text, expanded]);
  return (
    <>
      <p
        ref={ref}
        className={`${className ?? ''} ${expanded ? '' : 'clamp'}`}
        style={{ WebkitLineClamp: expanded ? undefined : lines }}
      >
        {text}
      </p>
      {overflows ? (
        <button className="link link-inline" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function QuestionText({ text }: { text: string }) {
  const [first = '', ...rest] = text.split(/\n\s*\n/);
  if (!LOCATION_LINE.test(first)) return <p className="question">{text}</p>;
  const body = rest.join('\n\n');
  return (
    <>
      <p className="question-location mono">{first}</p>
      {body !== '' ? <p className="question">{body}</p> : null}
    </>
  );
}

function CouncilIcon({ title }: { title?: string }) {
  return (
    <svg className="council-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-label="Council pick">
      <title>{title ?? 'Council pick'}</title>
      <g stroke="#a371f7" strokeWidth="1.2" fill="rgba(163,113,247,0.22)">
        <circle cx="7" cy="4.6" r="3.4" />
        <circle cx="4.3" cy="9.3" r="3.4" />
        <circle cx="9.7" cy="9.3" r="3.4" />
      </g>
    </svg>
  );
}

function answerExcerpt(todo: Todo): string | null {
  const answer = todo.answer;
  if (answer === null || todo.state !== 'answered') return null;
  if (answer.comment === true) return 'Comment queued';
  if (answer.deferred) return 'Deferred';
  if (answer.optionId !== null) return optionsFor(todo).find((o) => o.id === answer.optionId)?.label ?? answer.optionId;
  const note = answer.text.trim().split('\n')[0] ?? '';
  return note === '' ? 'Answered' : note;
}

function optionNumber(options: Option[], optionId: string | undefined): number | null {
  const index = options.findIndex((option) => option.id === optionId);
  return index === -1 ? null : index + 1;
}

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 3.5 H14 V6.5 H2 Z M3 6.5 V12.5 Q3 13 3.5 13 H12.5 Q13 13 13 12.5 V6.5 M6.5 9.2 H9.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 6.5 V12.5 Q3 13 3.5 13 H12.5 Q13 13 13 12.5 V6.5 M8 10.5 V3 M5.2 5.6 L8 2.8 L10.8 5.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThreadRow(props: { thread: Thread; selected: boolean; unseen: number; flashing: boolean; onSelect: () => void; onArchive: () => void }) {
  const { thread, selected } = props;
  const { session } = thread;
  const branch = session.branch === '' ? 'detached' : session.branch;
  const action = thread.archived ? 'Unarchive' : 'Archive';
  return (
    <div className="thread-item" data-archived={thread.archived} data-flash={props.flashing}>
      <button
        className="thread-row"
        data-selected={selected}
        title={`${session.repo} · ${branch} · ${session.workspaceName}`}
        onClick={props.onSelect}
      >
        <div className="thread-top">
          <LiveMark state={thread.live} />
          <span className="thread-mode" data-mode={thread.mode} title={MODE_TITLE[thread.mode]}>
            <ModeIcon mode={thread.mode} />
          </span>
          <span className="thread-name">{thread.displayName}</span>
          {props.unseen > 0 ? <span className="newpill">{props.unseen} new</span> : null}
          {thread.answeredCount > 0 ? <span className="badge badge-ready">{thread.answeredCount} ready</span> : null}
          {thread.openCount > 0 ? <span className="badge">{thread.openCount}</span> : null}
        </div>
        <div className="thread-desc">
          {thread.live === 'working' && thread.step !== null ? <StepLine key={thread.step.text} text={thread.step.text} /> : thread.description}
        </div>
      </button>
      <button className="icon-btn row-action" title={action} aria-label={action} onClick={props.onArchive}>
        {thread.archived ? <RestoreIcon /> : <ArchiveIcon />}
      </button>
    </div>
  );
}

function ThreadsPane(props: {
  threads: Thread[];
  selectedId: string | null;
  now: number;
  flashing: ReadonlySet<string>;
  showArchived: boolean;
  teamOpen: boolean;
  onToggleArchived: () => void;
  onToggleTeam: () => void;
  onCloseTeam: () => void;
  onSelect: (sessionId: string) => void;
  onArchive: (thread: Thread) => void;
}) {
  const online = props.threads.some((thread) => thread.live === 'working' || thread.live === 'waiting_on_you');
  const firstArchived = props.threads.findIndex((thread) => thread.archived);
  return (
    <aside className="pane threads">
      <header className="pane-header">
        <h1>Mission Control</h1>
      </header>
      <div className="pane-scroll">
        {props.threads.length === 0 ? <div className="empty">No sessions need you.</div> : null}
        {props.threads.map((thread, index) => (
          <div key={thread.sessionId}>
            {index === firstArchived ? <div className="section-label">Archived</div> : null}
            <ThreadRow
              thread={thread}
              selected={thread.sessionId === props.selectedId}
              unseen={unseenCount(thread, props.selectedId)}
              flashing={props.flashing.has(thread.sessionId)}
              onSelect={() => props.onSelect(thread.sessionId)}
              onArchive={() => props.onArchive(thread)}
            />
          </div>
        ))}
      </div>
      {props.teamOpen ? <TeamPane thread={props.threads.find((t) => t.sessionId === props.selectedId) ?? null} now={props.now} onClose={props.onCloseTeam} /> : null}
      <Dock
        showArchived={props.showArchived}
        online={online}
        teamOpen={props.teamOpen}
        onToggleArchived={props.onToggleArchived}
        onToggleTeam={props.onToggleTeam}
      />
    </aside>
  );
}

function TodoRow(props: { entry: Entry; selected: boolean; showRun: boolean; leaving: boolean; onSelect: () => void }) {
  const { entry, selected, showRun, onSelect } = props;
  const { todo, run } = entry;
  const excerpt = answerExcerpt(todo);
  const messages = todo.conversation ?? [];
  const unread = messages[messages.length - 1]?.from === 'agent' ? messages.length : 0;
  return (
    <button className="todo-row" data-selected={selected} data-state={todo.state} data-leaving={props.leaving} onClick={onSelect}>
      <span className="todo-icon">
        <StateIcon state={todo.state} />
      </span>
      <span className="todo-body">
        <span className="todo-head">
          <span className="todo-title">{todo.title}</span>
          {todo.category === 'needs-you' && isSplit(todo.positions) ? <span className="todo-split">split</span> : null}
          {unread > 0 ? (
            <span className="chat-count" title="The agent replied">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 2.5 H10 V8 H6.2 L4 10 V8 H2 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              {unread}
            </span>
          ) : null}
          <span className="todo-id mono">{todo.id}</span>
        </span>
        {excerpt !== null ? <span className="todo-answer">→ {excerpt}</span> : null}
        {showRun ? <span className="todo-run">{run.title}</span> : null}
      </span>
    </button>
  );
}

function CouncilRow(props: { entry: Entry; selected: boolean; leaving: boolean; onSelect: () => void }) {
  const { entry, selected, onSelect } = props;
  const { todo } = entry;
  return (
    <button className="council-row" data-selected={selected} data-state={todo.state} data-leaving={props.leaving} title={todo.title} onClick={onSelect}>
      <span className="todo-icon">{todo.answer?.preset === true ? <CouncilIcon /> : <StateIcon state={todo.state} />}</span>
      <span className="council-title">{todo.title}</span>
      <span className="todo-id mono">{todo.id}</span>
    </button>
  );
}

type TodosPaneProps = {
  thread: Thread;
  entries: Entry[];
  ghosts: Ghost[];
  glowTab: Tab | null;
  tab: Tab;
  selectedKey: string | null;
  councilOpen: boolean;
  onToggleCouncil: () => void;
  onTab: (tab: Tab) => void;
  onSelect: (key: string) => void;
  confirming: boolean;
  questions: number;
  onSubmit: () => void;
  onCopyPrompt: () => void;
};

function TodosPane(props: TodosPaneProps) {
  const { thread, tab, entries } = props;
  const dead = thread.live === 'dead';
  const count = thread.answeredCount;
  const total = count + props.questions;
  const shown = entries.map((entry) => ({ entry, leaving: false }));
  [...props.ghosts]
    .sort((a, b) => a.index - b.index)
    .forEach((ghost) => shown.splice(Math.min(ghost.index, shown.length), 0, { entry: ghost.entry, leaving: true }));
  const reviewing = shown.filter((row) => row.entry.todo.kind === 'finding');
  const needs = shown.filter((row) => row.entry.todo.kind !== 'finding' && isNeedsYou(row.entry));
  const council = shown.filter((row) => row.entry.todo.kind !== 'finding' && !isNeedsYou(row.entry));
  const showRun = thread.runs.filter((r) => r.status === 'active').length > 1;
  return (
    <aside className="pane todos">
      <header className="pane-header">
        <div className="tabs" role="tablist" style={{ '--i': TABS.findIndex((t) => t.id === tab) } as CSSProperties}>
          <i className="tab-pill" />
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tab} data-glow={t.id === props.glowTab} className="tab" onClick={() => props.onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="pane-scroll todos-scroll">
        {shown.length === 0 ? (
          <div className="caught-up">
            <svg className="enso" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="20" />
            </svg>
            <div className="caught-up-title">All caught up</div>
            <div className="caught-up-note">
              {thread.runs.length === 0 ? 'Agents are still working' : 'Nothing needs you in this session'}
            </div>
          </div>
        ) : null}
        {needs.length > 0 ? (
          <section className="needs">
            <div className="section-label">{sectionLabel(thread.mode, tab, false)} · {needs.filter((row) => !row.leaving).length}</div>
            {needs.map(({ entry, leaving }) => (
              <TodoRow
                key={todoKey(entry)}
                entry={entry}
                selected={todoKey(entry) === props.selectedKey}
                showRun={showRun}
                leaving={leaving}
                onSelect={() => props.onSelect(todoKey(entry))}
              />
            ))}
          </section>
        ) : null}
        {reviewing.length > 0 ? (
          <section className="needs">
            <div className="section-label">{sectionLabel(thread.mode, tab, true)} · {reviewing.filter((row) => !row.leaving).length}</div>
            {reviewing.map(({ entry, leaving }) => (
              <TodoRow
                key={todoKey(entry)}
                entry={entry}
                selected={todoKey(entry) === props.selectedKey}
                showRun={showRun}
                leaving={leaving}
                onSelect={() => props.onSelect(todoKey(entry))}
              />
            ))}
          </section>
        ) : null}
        {council.length > 0 ? (
          <section className="council">
            <button className="council-toggle" aria-expanded={props.councilOpen} onClick={props.onToggleCouncil}>
              <CouncilIcon />
              <span>Council picks · {council.filter((row) => !row.leaving).length}</span>
              <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M4 2.5 L7.5 6 L4 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {props.councilOpen
              ? council.map(({ entry, leaving }) => (
                  <CouncilRow
                    key={todoKey(entry)}
                    entry={entry}
                    selected={todoKey(entry) === props.selectedKey}
                    leaving={leaving}
                    onSelect={() => props.onSelect(todoKey(entry))}
                  />
                ))
              : null}
          </section>
        ) : null}
      </div>
      <footer className="todos-footer">
        {dead ? (
          <>
            <button className="btn btn-primary" onClick={props.onCopyPrompt}>
              Copy prompt
            </button>
            <span className="footer-note">Session ended · paste into Conductor</span>
          </>
        ) : (
          <>
            {props.confirming ? (
              <SubmitConfirm name={thread.displayName} />
            ) : (
              <button className="btn btn-primary" disabled={total === 0} onClick={props.onSubmit}>
                {submitLabel(count, props.questions)}
              </button>
            )}
            <button className="link" onClick={props.onCopyPrompt}>
              Copy prompt
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="bullets">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function OptionCard(props: {
  option: Option;
  index: number;
  checked: boolean;
  recommended: boolean;
  disabled: boolean;
  voters: Agent[];
  onPick: () => void;
}) {
  const { option } = props;
  return (
    <button className="option-card" role="radio" aria-checked={props.checked} disabled={props.disabled} onClick={props.onPick}>
      <span className="radio" />
      <span className="option-body">
        <span className="option-label">
          {option.label}
          {props.recommended ? <Chip className="recommended">Recommended</Chip> : null}
        </span>
        {option.description !== undefined ? <span className="option-desc">{option.description}</span> : null}
      </span>
      <span className="option-side">
        {props.voters.length > 0 ? <AvatarStack agents={props.voters} size={20} /> : null}
        {props.index < 9 ? <kbd>{props.index + 1}</kbd> : null}
      </span>
    </button>
  );
}

function ChairsCall({ todo, agents }: { todo: Todo; agents: Agent[] }) {
  const { recommendation } = todo;
  if (recommendation === null) return null;
  const label = optionsFor(todo).find((option) => option.id === recommendation.optionId)?.label;
  return (
    <div className="chairs-call">
      <Avatar agent={agentOf(agents, recommendation.by)} size={16} />
      <div className="chairs-body">
        <span>{label === undefined ? "Chair's call" : `Chair's call: ${label}`}</span>
        <ClampText key={recommendation.summary} text={recommendation.summary} lines={2} className="muted" />
      </div>
    </div>
  );
}

function PositionCard({ todo, position, agents, onCopy }: { todo: Todo; position: Todo['positions'][number]; agents: Agent[]; onCopy: (text: string) => void }) {
  const agent = agentOf(agents, position.agent);
  const number = optionNumber(optionsFor(todo), position.optionId);
  const matches = number !== null && position.optionId === todo.recommendation?.optionId;
  return (
    <div className="position">
      <div className="position-head">
        <Avatar agent={agent} size={32} />
        <div className="position-name">{agent.name}</div>
        <Chip className={matches ? 'stance stance-match' : 'stance'} title={position.stance}>
          {number === null ? position.stance : `Option ${number}`}
        </Chip>
      </div>
      <p>{position.summary}</p>
      {position.reason !== undefined ? <ClampText key={position.reason} text={position.reason} lines={3} className="muted" /> : null}
      {position.evidence !== undefined && position.evidence.length > 0 ? (
        <div className="refs">
          {position.evidence.map((ref) => (
            <button key={ref} className="ref mono" onClick={() => onCopy(ref)} title="Copy reference">
              {ref}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PositionsSection({ todo, agents, onCopy }: { todo: Todo; agents: Agent[]; onCopy: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const first = todo.positions[0]?.optionId;
  const unanimous = todo.positions.length > 1 && first !== undefined && todo.positions.every((p) => p.optionId === first);
  const number = optionNumber(optionsFor(todo), first);
  return (
    <section>
      <h3>Positions</h3>
      {unanimous ? (
        <div className="positions-summary">
          <AvatarStack agents={todo.positions.map((p) => agentOf(agents, p.agent))} size={22} />
          <span>
            All {todo.positions.length} picked option {number ?? first}
          </span>
          <button className="link" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide reasoning' : 'Show reasoning'}
          </button>
        </div>
      ) : null}
      {!unanimous || expanded ? (
        <div className="positions">
          {todo.positions.map((position) => (
            <PositionCard key={position.agent} todo={todo} position={position} agents={agents} onCopy={onCopy} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AnswerSummary({ todo }: { todo: Todo }) {
  const answer = todo.answer;
  const rows: [string, string | null, boolean][] = [
    ['Answer', answer === null ? null : capitalize(chosenLabel(todo)), false],
    ['Note', answer !== null && answer.text.trim() !== '' ? answer.text : null, false],
  ];
  return (
    <dl className="summary">
      {rows
        .filter((row): row is [string, string, boolean] => row[1] !== null)
        .map(([name, value, mono]) => (
          <div key={name} className="summary-row">
            <dt>{name}</dt>
            <dd className={mono ? 'mono' : undefined}>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

type DetailProps = {
  mode: RunMode;
  pr: RunPr | null;
  instantAsk: boolean;
  busy: Busy | null;
  entry: Entry;
  agents: Agent[];
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  onAccept: () => void;
  onSave: () => void;
  onAsk: () => void;
  onReopen: () => void;
  onCopy: (text: string) => void;
};

function AsyncLabel({ status, idle, done = '✓ Saved' }: { status: Busy['status'] | undefined; idle: string; done?: string }) {
  if (status === 'saving') {
    return (
      <>
        <i className="spinner" />
        Saving
      </>
    );
  }
  return <>{status === 'saved' ? done : idle}</>;
}

function AnswerBar(props: DetailProps) {
  const { todo } = props.entry;
  let content: ReactNode;
  if (todo.state === 'dismissed') {
    content = (
      <div className="answer-actions">
        <span className="answer-status">Dismissed</span>
      </div>
    );
  } else if (!isEditable(todo)) {
    content = <AnswerSummary todo={todo} />;
  } else {
    content = (
      <>
        <textarea
          value={props.draft.text}
          placeholder="Add a note for the agents (optional)"
          rows={2}
          onChange={(e) => props.onDraft({ text: e.target.value })}
        />
        <div className="answer-actions">
          {todo.recommendation !== null ? (
            <button
              className="btn btn-gold btn-async"
              data-status={props.busy?.kind === 'accept' ? props.busy.status : undefined}
              disabled={props.busy !== null}
              onClick={props.onAccept}
            >
              <AsyncLabel status={props.busy?.kind === 'accept' ? props.busy.status : undefined} idle="Accept recommendation" />
            </button>
          ) : null}
          <span className="answer-actions-end">
            {todo.state === 'answered' ? (
              <button className="link" onClick={props.onReopen}>
                Reopen
              </button>
            ) : null}
            <button
              className="btn btn-async"
              data-status={props.busy?.kind === 'ask' ? props.busy.status : undefined}
              disabled={props.draft.text.trim() === '' || props.busy !== null}
              title="Ask the agent a question right now, without answering"
              onClick={props.onAsk}
            >
              <AsyncLabel status={props.busy?.kind === 'ask' ? props.busy.status : undefined} idle="Ask the agent" />
            </button>
            <button
              className="btn btn-primary btn-async"
              data-status={props.busy?.kind === 'save' ? props.busy.status : undefined}
              disabled={!canSave(props.draft) || props.busy !== null}
              onClick={props.onSave}
            >
              <AsyncLabel
                status={props.busy?.kind === 'save' ? props.busy.status : undefined}
                idle={todo.state === 'answered' ? 'Update answer' : 'Save answer'}
              />
            </button>
          </span>
        </div>
      </>
    );
  }
  return (
    <footer className="answer-bar">
      <div className="answer-bar-inner">{content}</div>
    </footer>
  );
}

function DetailPane(props: DetailProps) {
  const { entry, agents, draft } = props;
  const { run, todo } = entry;
  const editable = isEditable(todo);
  const options = optionsFor(todo);
  return (
    <>
      <div className="detail-scroll">
      <article className="detail-inner">
        <header className="detail-head">
          <span className="detail-id mono">{todo.id}</span>
          <div className="detail-title">
            <h2>{todo.title}</h2>
            <ModeTag mode={props.mode} pr={props.pr} />
            {todo.answer?.preset === true ? <CouncilIcon title={COUNCIL_TOOLTIP} /> : null}
          </div>
          <div className="detail-sub">
            <span>{run.title}</span>
            <Chip className="skill">{run.skill}</Chip>
          </div>
          <Lifecycle state={todo.state} />
        </header>
        {todo.question !== '' ? <QuestionText text={todo.question} /> : null}
        {todo.conversation !== undefined && todo.conversation.length > 0 ? <Conversation messages={todo.conversation} agents={agents} instantAsk={props.instantAsk} /> : null}
        {options.length > 0 ? (
          <section>
            <h3>Options</h3>
            <div className="options" role="radiogroup">
              {options.map((option, index) => (
                <OptionCard
                  key={option.id}
                  option={option}
                  index={index}
                  checked={draft.optionId === option.id}
                  recommended={todo.recommendation?.optionId === option.id}
                  disabled={!editable}
                  voters={todo.positions.filter((p) => p.optionId === option.id).map((p) => agentOf(agents, p.agent))}
                  onPick={() => props.onDraft({ optionId: option.id })}
                />
              ))}
            </div>
          </section>
        ) : null}
        {todo.recommendation !== null && isSplit(todo.positions) ? <ChairsCall todo={todo} agents={agents} /> : null}
        {todo.positions.length > 0 ? <PositionsSection key={`${run.runId}/${todo.id}`} todo={todo} agents={agents} onCopy={props.onCopy} /> : null}
        {todo.diffs !== undefined && todo.diffs.length > 0 ? (
          <section>
            <h3>Change</h3>
            <div className="diffs">
              {todo.diffs.map((diff) => (
                <Diff key={diff.path} path={diff.path} patch={diff.patch} />
              ))}
            </div>
          </section>
        ) : null}
        {todo.tradeoffs.length > 0 || todo.caveats.length > 0 ? (
          <section className="lists">
            <BulletList title="Tradeoffs" items={todo.tradeoffs} />
            <BulletList title="Caveats" items={todo.caveats} />
          </section>
        ) : null}
        <section>
          <h3>History</h3>
          <History run={run} todo={todo} agents={agents} />
        </section>
        {todo.evidence.length > 0 || todo.links.length > 0 ? (
          <section>
            <h3>Evidence</h3>
            <div className="evidence">
              {todo.evidence.map((item) => (
                <button key={item.ref} className="evidence-row" onClick={() => props.onCopy(item.ref)} title="Copy reference">
                  <span className="mono">{item.ref}</span>
                  {item.note !== undefined ? <span className="muted">{item.note}</span> : null}
                </button>
              ))}
              {todo.links.map((link) => (
                <a key={link.url} className="evidence-row" href={link.url} target="_blank" rel="noreferrer">
                  <span>{link.label}</span>
                  <span className="muted mono">{link.url}</span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </article>
      </div>
      <AnswerBar {...props} />
    </>
  );
}

export function App() {
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>('overview');
  const [teamOpen, setTeamOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [snack, setSnack] = useState<SnackState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const snackId = useRef(0);
  const undoRef = useRef<Undo | null>(null);
  const entryKeyRef = useRef<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const threads = useThreads(showArchived) ?? [];
  const now = useNow();
  usePresence();

  const thread = threads.find((t) => t.sessionId === sessionId) ?? threads[0] ?? null;
  const flashing = useNewTodos(threads, thread?.sessionId ?? null);
  const [, setClock] = useState(0);
  const questionCount = thread === null ? 0 : deliverableQuestionCount(thread.runs, Date.now());
  useEffect(() => {
    const waits = threads
      .flatMap((t) => t.runs.flatMap((run) => run.todos.map(latestThinhMessage)))
      .filter((message) => message?.pending === true && message.submittedAt === undefined && message.fallbackFailed !== true)
      .map((message) => new Date((message as { at: string }).at).getTime() + QUESTION_PATIENCE_MS - Date.now())
      .filter((remaining) => remaining > 0);
    if (waits.length === 0) return;
    const timer = setTimeout(() => setClock((tick) => tick + 1), Math.min(...waits) + 50);
    return () => clearTimeout(timer);
  }, [threads]);
  const [councilOpen, toggleCouncil] = useCouncilOpen(thread?.sessionId ?? '');
  const entries = thread === null ? [] : entriesOf(thread, tab);
  const navigable = councilOpen ? entries : entries.filter(isNeedsYou);
  const allEntries = thread === null ? [] : entriesOf(thread, 'all');
  const entry = allEntries.find((e) => todoKey(e) === selectedKey) ?? navigable[0] ?? entries[0] ?? null;
  const entryKey = entry === null ? null : todoKey(entry);
  const { ghosts, glowTab } = useLeaving(entries, allEntries, `${thread?.sessionId ?? ''}:${tab}`);
  const draft = entry === null || entryKey === null ? null : (drafts[entryKey] ?? initialDraft(entry.todo));
  const decisionActive = view === 'decision' && entry !== null && draft !== null;
  entryKeyRef.current = entryKey;

  function flash(message: string): void {
    setToast(message);
    if (toastTimer.current !== undefined) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), FLASH_MS);
  }

  async function copyText(text: string, message: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    flash(message);
  }

  async function perform(path: string, body?: unknown): Promise<boolean> {
    const response = await postJson(path, body);
    if (!response.ok) flash(response.status === 409 ? 'Already sent, cannot change' : 'Request failed');
    return response.ok;
  }

  function patchDraft(patch: Partial<Draft>): void {
    if (entry === null || entryKey === null || draft === null) return;
    setDrafts((prev) => ({ ...prev, [entryKey]: { ...draft, ...patch } }));
  }

  function selectNextOpen(): void {
    const index = navigable.findIndex((e) => todoKey(e) === entryKey);
    const others = [...navigable.slice(index + 1), ...navigable.slice(0, Math.max(index, 0))];
    const next = others.find((e) => e.todo.state === 'open');
    if (next !== undefined) setSelectedKey(todoKey(next));
  }

  function announce(text: string, undo: Undo | null): void {
    snackId.current += 1;
    undoRef.current = undo;
    setSnack({ id: snackId.current, text, undoable: undo !== null });
    if (snackTimer.current !== undefined) clearTimeout(snackTimer.current);
    snackTimer.current = setTimeout(() => setSnack(null), SNACK_MS);
  }

  async function undoSnack(): Promise<void> {
    const undo = undoRef.current;
    if (undo === null) return;
    const message = await undo();
    if (message === null) {
      if (snackTimer.current !== undefined) clearTimeout(snackTimer.current);
      setSnack(null);
    } else {
      announce(message, null);
    }
  }

  async function answer(next: Draft, kind: 'save' | 'accept'): Promise<void> {
    if (entry === null || entryKey === null) return;
    const target = entry;
    const targetKey = entryKey;
    setDrafts((prev) => ({ ...prev, [targetKey]: next }));
    setBusy({ kind, status: 'saving' });
    const ok = await perform(`${todoPath(target)}/answer`, { optionId: next.optionId, text: next.text, deferred: false });
    if (!ok) return setBusy(null);
    setBusy({ kind, status: 'saved' });
    await new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : SAVED_MS));
    setBusy(null);
    if (entryKeyRef.current === targetKey) selectNextOpen();
  }

  async function accept(): Promise<void> {
    if (entry === null || busy !== null) return;
    const { recommendation } = entry.todo;
    if (recommendation === null) return;
    await answer({ optionId: recommendation.optionId ?? null, text: '' }, 'accept');
  }

  async function save(): Promise<void> {
    if (draft !== null && busy === null && canSave(draft)) await answer(draft, 'save');
  }

  async function ask(): Promise<void> {
    if (entry === null || entryKey === null || draft === null || busy !== null || draft.text.trim() === '') return;
    const text = draft.text;
    setBusy({ kind: 'ask', status: 'saving' });
    const ok = await perform(`${todoPath(entry)}/ask`, { text });
    setBusy(null);
    if (ok) setDrafts((prev) => ({ ...prev, [entryKey]: { ...draft, text: '' } }));
  }

  async function askFinding(text: string): Promise<void> {
    if (entry !== null) await perform(`${todoPath(entry)}/ask`, { text });
  }

  async function reopenEntry(target: Entry): Promise<string | null> {
    setDrafts((prev) => ({ ...prev, [todoKey(target)]: initialDraft({ ...target.todo, answer: null }) }));
    await perform(`${todoPath(target)}/reopen`);
    return null;
  }

  async function settleFinding(action: 'understood' | 'drop'): Promise<void> {
    if (entry === null || busy !== null) return;
    const target = entry;
    if (!(await perform(`${todoPath(target)}/${action}`))) return;
    announce(`${target.todo.id} ${action === 'drop' ? 'dropped' : 'understood'}`, () => reopenEntry(target));
    selectNextOpen();
  }

  async function postComment(): Promise<void> {
    if (entry === null || draft === null || busy !== null || draft.text.trim() === '') return;
    const target = entry;
    if (!(await perform(`${todoPath(target)}/comment`, { text: draft.text }))) return;
    announce(`Comment queued for ${target.todo.id}`, () => reopenEntry(target));
    selectNextOpen();
  }

  async function reopen(): Promise<void> {
    if (entry !== null) await reopenEntry(entry);
  }

  async function unsubmit(sessionId: string, submissionIds: string[]): Promise<string | null> {
    let reverted = 0;
    let pickedUp = 0;
    for (const submissionId of submissionIds) {
      const response = await postJson(`/api/threads/${encodeURIComponent(sessionId)}/unsubmit`, { submissionId });
      if (!response.ok) continue;
      const result = (await response.json()) as { reverted: number; pickedUp: number };
      reverted += result.reverted;
      pickedUp += result.pickedUp;
    }
    if (reverted === 0 && pickedUp > 0) return 'Already picked up by the agent';
    setConfirmingId(null);
    return null;
  }

  async function submit(): Promise<void> {
    if (thread === null || thread.answeredCount + questionCount === 0) return;
    const target = thread;
    const response = await postJson(`/api/threads/${encodeURIComponent(target.sessionId)}/submit`);
    if (!response.ok) return flash('Submit failed');
    const { submitted, questions, submissionIds } = (await response.json()) as {
      submitted: number;
      questions: number;
      submissionIds: string[];
    };
    setConfirmingId(target.sessionId);
    if (confirmTimer.current !== undefined) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmingId(null), CONFIRM_MS);
    announce(`${sentSummary(submitted, questions)} sent to ${target.displayName}`, () =>
      unsubmit(target.sessionId, submissionIds),
    );
  }

  async function copyPrompt(): Promise<void> {
    if (thread === null) return;
    const response = await fetch(`/api/threads/${encodeURIComponent(thread.sessionId)}/prompt`);
    const { text } = (await response.json()) as { text: string };
    await copyText(text, 'Prompt copied');
  }

  function selectThread(id: string): void {
    setSessionId(id);
    setSelectedKey(null);
    setView('overview');
  }

  function selectTodo(key: string): void {
    setSelectedKey(key);
    setView('decision');
  }

  function openTodo(key: string): void {
    const target = allEntries.find((e) => todoKey(e) === key);
    if (target !== undefined && !matchesTab(target.todo, tab)) {
      setTab(tabOf(target.todo));
    }
    selectTodo(key);
  }

  async function toggleArchive(target: Thread): Promise<void> {
    const action = target.archived ? 'unarchive' : 'archive';
    await perform(`/api/threads/${encodeURIComponent(target.sessionId)}/${action}`);
  }

  function moveTodo(delta: number): void {
    const index = decisionActive ? navigable.findIndex((e) => todoKey(e) === entryKey) : -1;
    const next = navigable[Math.min(navigable.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) selectTodo(todoKey(next));
  }

  function moveThread(delta: number): void {
    const index = threads.findIndex((t) => t.sessionId === thread?.sessionId);
    const next = threads[Math.min(threads.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) selectThread(next.sessionId);
  }

  function pickOption(index: number): void {
    if (!decisionActive || entry === null || !isEditable(entry.todo)) return;
    const option = optionsFor(entry.todo)[index];
    if (option !== undefined) patchDraft({ optionId: option.id });
  }

  function renderMiddle(active: Thread): ReactNode {
    if (!decisionActive) return <Overview thread={active} now={now} onTab={setTab} onOpenTodo={openTodo} />;
    if (entry.todo.kind === 'finding') {
      return (
        <FindingPane
          mode={active.mode}
          pr={active.pr}
          run={entry.run}
          todo={entry.todo}
          agents={active.agents}
          instantAsk={active.instantAsk}
          draft={draft.text}
          busy={busy !== null}
          onDraft={(text) => patchDraft({ text })}
          onGotIt={() => void settleFinding('understood')}
          onDrop={() => void settleFinding('drop')}
          onPost={() => void postComment()}
          onReopen={() => void reopen()}
          onAsk={(text) => void askFinding(text)}
          onCopy={(text) => void copyText(text, 'Copied')}
        />
      );
    }
    return (
      <DetailPane
        mode={active.mode}
        pr={active.pr}
        entry={entry}
        agents={active.agents}
        instantAsk={active.instantAsk}
        draft={draft}
        onDraft={patchDraft}
        onAccept={() => void accept()}
        onSave={() => void save()}
        onAsk={() => void ask()}
        onReopen={() => void reopen()}
        onCopy={(text) => void copyText(text, 'Copied')}
        busy={busy}
      />
    );
  }

  function paletteItems(): PaletteItem[] {
    const editable = decisionActive && entry !== null && isEditable(entry.todo);
    const actions: PaletteItem[] = [];
    if (editable && entry !== null && entry.todo.recommendation !== null) {
      actions.push({ id: 'accept', title: 'Accept recommendation', subtitle: entry.todo.title, shortcut: 'a', run: () => void accept() });
    }
    if (editable) {
    }
    if (thread !== null && thread.answeredCount + questionCount > 0) {
      actions.push({
        id: 'submit',
        title: `${submitLabel(thread.answeredCount, questionCount)} to ${thread.displayName}`,
        subtitle: '',
        shortcut: '⌘↵',
        run: () => void submit(),
      });
    }
    actions.push({ id: 'overview', title: 'Overview', subtitle: thread?.displayName ?? '', shortcut: 'o', run: () => setView('overview') });
    if (thread !== null) {
      actions.push({
        id: 'archive',
        title: thread.archived ? 'Unarchive thread' : 'Archive thread',
        subtitle: thread.displayName,
        shortcut: 'e',
        run: () => void toggleArchive(thread),
      });
      actions.push({ id: 'prompt', title: 'Copy prompt', subtitle: thread.displayName, run: () => void copyPrompt() });
    }
    actions.push({
      id: 'archived',
      title: showArchived ? 'Hide archived' : 'Show archived',
      subtitle: '',
      run: () => setShowArchived(!showArchived),
    });
    const goThreads: PaletteItem[] = threads.map((t) => ({
      id: `thread:${t.sessionId}`,
      title: `Go to ${t.displayName}`,
      subtitle: t.description,
      run: () => selectThread(t.sessionId),
    }));
    const goTodos: PaletteItem[] = allEntries.map((e) => ({
      id: `todo:${todoKey(e)}`,
      title: e.todo.title,
      subtitle: `${e.todo.id} · ${thread?.displayName ?? ''}`,
      run: () => openTodo(todoKey(e)),
    }));
    return [...actions, ...goThreads, ...goTodos];
  }

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event) => {
    const modified = event.metaKey || event.ctrlKey;
    if (modified && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setPaletteOpen(!paletteOpen);
      return;
    }
    if (paletteOpen) return;
    if (event.key === 'Enter' && modified) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'Escape' && teamOpen) {
      setTeamOpen(false);
      return;
    }
    if (modified || event.altKey || isTyping(event.target)) return;
    const editable = decisionActive && entry !== null && isEditable(entry.todo) && entry.todo.kind !== 'finding';
    if (event.key === 'o') setView('overview');
    else if (event.key === 'e' && thread !== null) void toggleArchive(thread);
    else if (event.key === 'j') moveTodo(1);
    else if (event.key === 'k') moveTodo(-1);
    else if (event.key === '[') moveThread(-1);
    else if (event.key === ']') moveThread(1);
    else if (/^[1-9]$/.test(event.key)) pickOption(Number(event.key) - 1);
    else if (event.key === 'a' && editable) void accept();
    else if (event.key === 's' && editable) void save();
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => {
    document.querySelector('.todo-row[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [entryKey]);

  return (
    <div className="app">
      <ThreadsPane
        threads={threads}
        selectedId={thread?.sessionId ?? null}
        now={now}
        flashing={flashing}
        showArchived={showArchived}
        teamOpen={teamOpen}
        onToggleArchived={() => setShowArchived(!showArchived)}
        onToggleTeam={() => setTeamOpen(!teamOpen)}
        onCloseTeam={() => setTeamOpen(false)}
        onSelect={selectThread}
        onArchive={(target) => void toggleArchive(target)}
      />
      {thread === null ? (
        <main className="pane detail">
          <div className="empty empty-detail">No sessions need you.</div>
        </main>
      ) : (
        <main className="pane detail">
          <nav className="view-tabs" role="tablist">
            <button role="tab" aria-selected={!decisionActive} className="view-tab" onClick={() => setView('overview')}>
              Overview
            </button>
            <button
              role="tab"
              aria-selected={decisionActive}
              className="view-tab"
              disabled={entry === null}
              onClick={() => setView('decision')}
            >
              {entry?.todo.kind === 'finding' ? 'Finding' : 'Decision'}
            </button>
          </nav>
          {renderMiddle(thread)}
        </main>
      )}
      {thread !== null ? (
        <TodosPane
          thread={thread}
          entries={entries}
          ghosts={ghosts}
          glowTab={glowTab}
          tab={tab}
          selectedKey={entryKey}
          councilOpen={councilOpen}
          onToggleCouncil={toggleCouncil}
          onTab={setTab}
          onSelect={selectTodo}
          confirming={confirmingId === thread.sessionId}
          questions={questionCount}
          onSubmit={() => void submit()}
          onCopyPrompt={() => void copyPrompt()}
        />
      ) : (
        <aside className="pane todos" />
      )}
      {toast !== null ? <div className="toast">{toast}</div> : null}
      {snack !== null ? <Snackbar snack={snack} onUndo={() => void undoSnack()} /> : null}
      {paletteOpen ? <Palette items={paletteItems()} onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}
