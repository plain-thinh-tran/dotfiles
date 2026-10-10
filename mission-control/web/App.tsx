import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { chosenLabel, optionsFor } from '../src/prompt';
import type { Agent, LiveState, Option, Run, Thread, Todo, TodoState } from '../src/types';
import { Avatar, AvatarStack } from './Avatar';

type Tab = 'open' | 'sent' | 'done' | 'all';
type Draft = { optionId: string | null; text: string };
type Entry = { run: Run; todo: Todo };

const TABS: { id: Tab; label: string; states: TodoState[] | null }[] = [
  { id: 'open', label: 'Open', states: ['open', 'answered'] },
  { id: 'sent', label: 'Sent', states: ['submitted', 'picked_up'] },
  { id: 'done', label: 'Done', states: ['done', 'dismissed'] },
  { id: 'all', label: 'All', states: null },
];

const STATE_LABEL: Record<TodoState, string> = {
  open: 'Open',
  answered: 'Answered',
  submitted: 'Submitted',
  picked_up: 'Picked up',
  done: 'Done',
  dismissed: 'Dismissed',
};

const LIVE_LABEL: Record<LiveState, string> = {
  working: 'working',
  waiting_on_you: 'waiting on you',
  idle: 'idle',
  dead: 'dead',
  error: 'error',
};

const KIND_LABEL = { decision: 'Decision', question: 'Question', approval: 'Approval' } as const;
const CATEGORY_LABEL = { 'needs-you': 'Needs you', 'key-decision': 'Key decision' } as const;
const FLASH_MS = 1800;
const LOCATION_LINE = /^[\w-]+ at \S+/;

function useThreads(showDone: boolean): Thread[] | null {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  useEffect(() => {
    const source = new EventSource(`/api/events?done=${showDone ? 1 : 0}`);
    source.addEventListener('threads', (event) => {
      setThreads(JSON.parse((event as MessageEvent<string>).data) as Thread[]);
    });
    return () => source.close();
  }, [showDone]);
  return threads;
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
  const states = TABS.find((t) => t.id === tab)?.states ?? null;
  return states === null || states.includes(todo.state);
}

function entriesOf(thread: Thread, tab: Tab): Entry[] {
  return thread.runs.flatMap((run) => run.todos.filter((todo) => matchesTab(todo, tab)).map((todo) => ({ run, todo })));
}

function initialDraft(todo: Todo): Draft {
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

function StateIcon({ state }: { state: TodoState }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-label': STATE_LABEL[state] } as const;
  switch (state) {
    case 'open':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#a0a0aa" strokeWidth="1.5" />
        </svg>
      );
    case 'answered':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#3b82f6" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="3" fill="#3b82f6" />
        </svg>
      );
    case 'submitted':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#b7791f" strokeWidth="1.5" />
          <path d="M8 4.8 V8 L10 9.4" stroke="#b7791f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'picked_up':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#7c3aed" strokeWidth="1.5" />
          <path d="M5.2 8 H10.4 M8.4 5.8 L10.6 8 L8.4 10.2" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'done':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="7" fill="#22a06b" />
          <path d="M5 8.2 L7.1 10.3 L11 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'dismissed':
      return (
        <svg {...common}>
          <title>{STATE_LABEL[state]}</title>
          <circle cx="8" cy="8" r="6" stroke="#c4c4cc" strokeWidth="1.5" />
          <path d="M5.4 8 H10.6" stroke="#c4c4cc" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

function LiveDot({ state }: { state: LiveState }) {
  return <span className={`dot dot-${state}`} title={LIVE_LABEL[state]} />;
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

function CouncilPick({ todo }: { todo: Todo }) {
  return todo.answer?.preset === true ? <Chip className="council-pick">Council pick</Chip> : null;
}

function answerExcerpt(todo: Todo): string | null {
  const answer = todo.answer;
  if (answer === null || todo.state !== 'answered') return null;
  if (answer.deferred) return 'Deferred';
  if (answer.optionId !== null) return optionsFor(todo).find((o) => o.id === answer.optionId)?.label ?? answer.optionId;
  const note = answer.text.trim().split('\n')[0] ?? '';
  return note === '' ? 'Answered' : note;
}

function optionNumber(options: Option[], optionId: string | undefined): number | null {
  const index = options.findIndex((option) => option.id === optionId);
  return index === -1 ? null : index + 1;
}

function TodoChips({ todo }: { todo: Todo }) {
  return (
    <>
      <Chip className={`kind kind-${todo.kind}`}>{KIND_LABEL[todo.kind]}</Chip>
      <Chip className={`category category-${todo.category}`}>{CATEGORY_LABEL[todo.category]}</Chip>
    </>
  );
}

function ThreadRow({ thread, selected, onSelect }: { thread: Thread; selected: boolean; onSelect: () => void }) {
  const { session } = thread;
  const titles = thread.runs.filter((run) => run.status !== 'done' || thread.runs.every((r) => r.status === 'done')).slice(0, 3);
  return (
    <button className="thread-row" data-selected={selected} onClick={onSelect}>
      <div className="thread-top">
        <LiveDot state={thread.live} />
        <span className="thread-name">{session.workspaceName}</span>
        {thread.answeredCount > 0 ? <span className="badge badge-ready">{thread.answeredCount} ready</span> : null}
        {thread.openCount > 0 ? <span className="badge">{thread.openCount}</span> : null}
      </div>
      <div className="thread-sub">
        {session.repo} · {session.branch === '' ? 'detached' : session.branch}
      </div>
      <div className="thread-runs">
        {titles.map((run) => (
          <div key={run.runId} className="thread-run-title">
            {run.title}
          </div>
        ))}
      </div>
      <AvatarStack agents={thread.agents} size={24} />
    </button>
  );
}

function ThreadsPane(props: {
  threads: Thread[];
  selectedId: string | null;
  showDone: boolean;
  onToggleDone: (value: boolean) => void;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <aside className="pane threads">
      <header className="pane-header">
        <h1>Mission Control</h1>
        <label className="toggle">
          <input type="checkbox" checked={props.showDone} onChange={(e) => props.onToggleDone(e.target.checked)} />
          <span className="switch" />
          <span>Show done</span>
        </label>
      </header>
      <div className="pane-scroll">
        {props.threads.length === 0 ? <div className="empty">No sessions need you.</div> : null}
        {props.threads.map((thread) => (
          <ThreadRow
            key={thread.sessionId}
            thread={thread}
            selected={thread.sessionId === props.selectedId}
            onSelect={() => props.onSelect(thread.sessionId)}
          />
        ))}
      </div>
    </aside>
  );
}

function TodoRow({ entry, selected, onSelect }: { entry: Entry; selected: boolean; onSelect: () => void }) {
  const { todo } = entry;
  const excerpt = answerExcerpt(todo);
  return (
    <button className="todo-row" data-selected={selected} data-state={todo.state} onClick={onSelect}>
      <span className="todo-icon">
        <StateIcon state={todo.state} />
      </span>
      <span className="todo-body">
        <span className="todo-meta">
          <TodoChips todo={todo} />
          <CouncilPick todo={todo} />
          <span className="muted mono todo-id">{todo.id}</span>
        </span>
        <span className="todo-title">{todo.title}</span>
        {excerpt !== null ? <span className="todo-answer">→ {excerpt}</span> : null}
      </span>
    </button>
  );
}

type TodosPaneProps = {
  thread: Thread;
  tab: Tab;
  selectedKey: string | null;
  onTab: (tab: Tab) => void;
  onSelect: (key: string) => void;
  onSubmit: () => void;
  onCopyPrompt: () => void;
  onCopyPath: () => void;
  onFocusConductor: () => void;
};

function TodosPane(props: TodosPaneProps) {
  const { thread, tab } = props;
  const dead = thread.live === 'dead';
  const count = thread.answeredCount;
  const submitLabel = `Submit ${count} to ${thread.session.workspaceName}`;
  const groups = thread.runs.map((run) => ({ run, entries: entriesOf({ ...thread, runs: [run] }, tab) })).filter((g) => g.entries.length > 0);
  return (
    <aside className="pane todos">
      <header className="pane-header todos-header">
        <div className="todos-title">
          <span className="thread-name">{thread.session.workspaceName}</span>
          <LiveDot state={thread.live} />
          <span className="live-label muted">{LIVE_LABEL[thread.live]}</span>
        </div>
        <div className="workspace-path">
          <span className="path-text mono" title={thread.session.workspacePath}>
            <bdi>{thread.session.workspacePath}</bdi>
          </span>
          <button className="btn btn-small" onClick={props.onCopyPath}>
            Copy path
          </button>
          <button className="btn btn-small" onClick={props.onFocusConductor}>
            Focus Conductor
          </button>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tab} className="tab" onClick={() => props.onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="pane-scroll">
        {groups.length === 0 ? <div className="empty">Nothing here.</div> : null}
        {groups.map(({ run, entries }) => (
          <section key={run.runId} className="run-group">
            <div className="run-head">
              <span className="run-title">{run.title}</span>
              <Chip className="skill">{run.skill}</Chip>
              <AvatarStack agents={run.agents} size={18} />
            </div>
            {entries.map((entry) => (
              <TodoRow
                key={todoKey(entry)}
                entry={entry}
                selected={todoKey(entry) === props.selectedKey}
                onSelect={() => props.onSelect(todoKey(entry))}
              />
            ))}
          </section>
        ))}
      </div>
      <footer className="todos-footer">
        <div className="footer-actions">
          {dead ? (
            <>
              <button className="btn btn-primary" onClick={props.onCopyPrompt}>
                Copy prompt
              </button>
              <button className="btn" disabled={count === 0} onClick={props.onSubmit}>
                {submitLabel}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={count === 0} onClick={props.onSubmit}>
              {submitLabel}
            </button>
          )}
        </div>
        <button className="link" onClick={props.onCopyPrompt}>
          Copy prompt
        </button>
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

function RecommendationCard(props: { entry: Entry; agents: Agent[]; editable: boolean; onAccept: () => void }) {
  const { recommendation } = props.entry.todo;
  if (recommendation === null) return null;
  const agent = agentOf(props.agents, recommendation.by);
  const option = optionsFor(props.entry.todo).find((o) => o.id === recommendation.optionId);
  return (
    <section className="recommendation">
      <Avatar agent={agent} size={40} />
      <div className="recommendation-body">
        <div className="recommendation-by">Recommended by {agent.name}</div>
        <ClampText key={recommendation.summary} text={recommendation.summary} lines={4} />
        {option !== undefined ? <span className="recommended-option">{option.label}</span> : null}
      </div>
      <button className="btn btn-gold" disabled={!props.editable} onClick={props.onAccept}>
        Accept recommendation
      </button>
    </section>
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

function PositionCard({ todo, position, agents, onCopy }: { todo: Todo; position: Todo['positions'][number]; agents: Agent[]; onCopy: (text: string) => void }) {
  const agent = agentOf(agents, position.agent);
  const number = optionNumber(optionsFor(todo), position.optionId);
  const matches = number !== null && position.optionId === todo.recommendation?.optionId;
  return (
    <div className="position">
      <div className="position-head">
        <Avatar agent={agent} size={32} />
        <div className="position-who">
          <div className="position-name">{agent.name}</div>
          <div className="muted position-model">{agent.model}</div>
        </div>
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
  const rows: [string, string | null][] = [
    ['Answer', answer === null ? null : capitalize(chosenLabel(todo))],
    ['Note', answer !== null && answer.text.trim() !== '' ? answer.text : null],
    ['Answered', answer === null ? null : formatTime(answer.answeredAt)],
    ['Submitted', todo.submittedAt === null ? null : formatTime(todo.submittedAt)],
    ['Picked up', todo.pickedUpAt === null ? null : formatTime(todo.pickedUpAt)],
    ['Resolution', todo.resolution],
  ];
  return (
    <dl className="summary">
      {rows
        .filter((row): row is [string, string] => row[1] !== null)
        .map(([name, value]) => (
          <div key={name} className="summary-row">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

type DetailProps = {
  entry: Entry;
  agents: Agent[];
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  onAccept: () => void;
  onSave: () => void;
  onDefer: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onCopy: (text: string) => void;
};

function AnswerBar(props: DetailProps) {
  const { todo } = props.entry;
  let content: ReactNode;
  if (todo.state === 'dismissed') {
    content = (
      <div className="answer-actions">
        <span className="answer-status">Dismissed</span>
        <button className="btn" onClick={props.onReopen}>
          Reopen
        </button>
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
            <button className="btn btn-gold" onClick={props.onAccept}>
              Accept recommendation
            </button>
          ) : null}
          <span className="answer-actions-end">
            {todo.state === 'answered' ? (
              <button className="link" onClick={props.onReopen}>
                Reopen
              </button>
            ) : null}
            <button className="btn" onClick={props.onDismiss}>
              Dismiss
            </button>
            <button className="btn" onClick={props.onDefer}>
              Defer
            </button>
            <button className="btn btn-primary" disabled={!canSave(props.draft)} onClick={props.onSave}>
              {todo.state === 'answered' ? 'Update answer' : 'Save answer'}
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
    <main className="pane detail">
      <div className="detail-scroll">
      <article className="detail-inner">
        <header className="detail-head">
          <div className="chips">
            <TodoChips todo={todo} />
            <CouncilPick todo={todo} />
            <span className="muted mono">{todo.id}</span>
          </div>
          <h2>{todo.title}</h2>
          <div className="detail-sub">
            <span>{run.title}</span>
            <Chip className="skill">{run.skill}</Chip>
          </div>
        </header>
        {todo.question !== '' ? <QuestionText text={todo.question} /> : null}
        <RecommendationCard entry={entry} agents={agents} editable={editable} onAccept={props.onAccept} />
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
        {todo.positions.length > 0 ? <PositionsSection key={`${run.runId}/${todo.id}`} todo={todo} agents={agents} onCopy={props.onCopy} /> : null}
        {todo.tradeoffs.length > 0 || todo.caveats.length > 0 ? (
          <section className="lists">
            <BulletList title="Tradeoffs" items={todo.tradeoffs} />
            <BulletList title="Caveats" items={todo.caveats} />
          </section>
        ) : null}
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
    </main>
  );
}

export function App() {
  const [showDone, setShowDone] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const threads = useThreads(showDone) ?? [];

  const thread = threads.find((t) => t.sessionId === sessionId) ?? threads[0] ?? null;
  const entries = thread === null ? [] : entriesOf(thread, tab);
  const entry = entries.find((e) => todoKey(e) === selectedKey) ?? entries[0] ?? null;
  const entryKey = entry === null ? null : todoKey(entry);
  const draft = entry === null || entryKey === null ? null : (drafts[entryKey] ?? initialDraft(entry.todo));

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
    const index = entries.findIndex((e) => todoKey(e) === entryKey);
    const others = [...entries.slice(index + 1), ...entries.slice(0, Math.max(index, 0))];
    const next = others.find((e) => e.todo.state === 'open');
    if (next !== undefined) setSelectedKey(todoKey(next));
  }

  async function answer(next: Draft, deferred: boolean): Promise<void> {
    if (entry === null || entryKey === null) return;
    setDrafts((prev) => ({ ...prev, [entryKey]: next }));
    const ok = await perform(`${todoPath(entry)}/answer`, { optionId: next.optionId, text: next.text, deferred });
    if (ok) selectNextOpen();
  }

  async function accept(): Promise<void> {
    if (entry === null) return;
    const { recommendation } = entry.todo;
    if (recommendation === null) return;
    await answer({ optionId: recommendation.optionId ?? null, text: '' }, false);
  }

  async function save(): Promise<void> {
    if (draft !== null && canSave(draft)) await answer(draft, false);
  }

  async function defer(): Promise<void> {
    if (draft !== null) await answer({ optionId: null, text: draft.text }, true);
  }

  async function dismiss(): Promise<void> {
    if (entry === null) return;
    const ok = await perform(`${todoPath(entry)}/dismiss`);
    if (ok) selectNextOpen();
  }

  async function reopen(): Promise<void> {
    if (entry === null || entryKey === null) return;
    setDrafts((prev) => ({ ...prev, [entryKey]: { optionId: null, text: '' } }));
    await perform(`${todoPath(entry)}/reopen`);
  }

  async function submit(): Promise<void> {
    if (thread === null || thread.answeredCount === 0) return;
    const response = await postJson(`/api/threads/${encodeURIComponent(thread.sessionId)}/submit`);
    if (!response.ok) return flash('Submit failed');
    const { submitted } = (await response.json()) as { submitted: number };
    flash(`Submitted ${submitted} to ${thread.session.workspaceName}`);
  }

  async function copyPrompt(): Promise<void> {
    if (thread === null) return;
    const response = await fetch(`/api/threads/${encodeURIComponent(thread.sessionId)}/prompt`);
    const { text } = (await response.json()) as { text: string };
    await copyText(text, 'Prompt copied');
  }

  async function focusConductor(): Promise<void> {
    await perform('/api/focus-conductor');
  }

  function selectThread(id: string): void {
    setSessionId(id);
    setSelectedKey(null);
  }

  function moveTodo(delta: number): void {
    const index = entry === null ? -1 : entries.findIndex((e) => todoKey(e) === entryKey);
    const next = entries[Math.min(entries.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) setSelectedKey(todoKey(next));
  }

  function moveThread(delta: number): void {
    const index = threads.findIndex((t) => t.sessionId === thread?.sessionId);
    const next = threads[Math.min(threads.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) selectThread(next.sessionId);
  }

  function pickOption(index: number): void {
    if (entry === null || !isEditable(entry.todo)) return;
    const option = optionsFor(entry.todo)[index];
    if (option !== undefined) patchDraft({ optionId: option.id });
  }

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event) => {
    const modified = event.metaKey || event.ctrlKey;
    if (event.key === 'Enter' && modified) {
      event.preventDefault();
      void submit();
      return;
    }
    if (modified || event.altKey || isTyping(event.target)) return;
    const editable = entry !== null && isEditable(entry.todo);
    if (event.key === 'j') moveTodo(1);
    else if (event.key === 'k') moveTodo(-1);
    else if (event.key === '[') moveThread(-1);
    else if (event.key === ']') moveThread(1);
    else if (/^[1-9]$/.test(event.key)) pickOption(Number(event.key) - 1);
    else if (event.key === 'a' && editable) void accept();
    else if (event.key === 's' && editable) void save();
    else if (event.key === 'd' && editable) void defer();
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
        showDone={showDone}
        onToggleDone={setShowDone}
        onSelect={selectThread}
      />
      {entry !== null && draft !== null && thread !== null ? (
        <DetailPane
          entry={entry}
          agents={thread.agents}
          draft={draft}
          onDraft={patchDraft}
          onAccept={() => void accept()}
          onSave={() => void save()}
          onDefer={() => void defer()}
          onDismiss={() => void dismiss()}
          onReopen={() => void reopen()}
          onCopy={(text) => void copyText(text, 'Copied')}
        />
      ) : (
        <main className="pane detail">
          <div className="empty empty-detail">{thread === null ? 'No sessions need you.' : 'Select a todo.'}</div>
        </main>
      )}
      {thread !== null ? (
        <TodosPane
          thread={thread}
          tab={tab}
          selectedKey={entryKey}
          onTab={setTab}
          onSelect={setSelectedKey}
          onSubmit={() => void submit()}
          onCopyPrompt={() => void copyPrompt()}
          onCopyPath={() => void copyText(thread.session.workspacePath, 'Path copied')}
          onFocusConductor={() => void focusConductor()}
        />
      ) : (
        <aside className="pane todos" />
      )}
      {toast !== null ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
