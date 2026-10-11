import { useEffect, useRef, useState } from 'react';
import { ROLE_NAMES, avatarKindOf } from '../src/avatars';
import { isAwaitingPickup, isReadyToSubmit } from '../src/prompt';
import type { LiveState, Run, Thread, Todo } from '../src/types';
import type { Tab } from './App';
import { Avatar } from './Avatar';
import { ModeTag } from './ModeTag';
import { prefersReducedMotion } from './motion';

type Slice = 'you' | 'council' | 'deferred' | 'dismissed' | 'open';
type FindingSlice = 'review' | 'understood' | 'queued' | 'commented' | 'dropped';

const LIVE_TEXT: Record<LiveState, string> = {
  working: 'Working',
  waiting_on_you: 'Waiting on you',
  idle: 'Idle',
  dead: 'Session ended',
  error: 'Error',
};

const SLICES: { id: Slice; label: string; color: string }[] = [
  { id: 'you', label: 'Decided by you', color: 'var(--green)' },
  { id: 'council', label: 'Council picks kept', color: 'var(--violet)' },
  { id: 'deferred', label: 'Deferred', color: 'var(--dim)' },
  { id: 'dismissed', label: 'Dismissed', color: 'var(--faint)' },
  { id: 'open', label: 'Still open', color: 'var(--amber)' },
];

const FINDING_SLICES: { id: FindingSlice; label: string; color: string }[] = [
  { id: 'review', label: 'To review', color: 'var(--amber)' },
  { id: 'understood', label: 'Understood', color: 'var(--green)' },
  { id: 'queued', label: 'Comments queued', color: 'var(--blue)' },
  { id: 'commented', label: 'Commented', color: 'var(--violet)' },
  { id: 'dropped', label: 'Dropped', color: 'var(--faint)' },
];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function relativeTime(iso: string, now: number): string {
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / MINUTE_MS))}m`;
  if (ms < DAY_MS) {
    const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${Math.floor(ms / HOUR_MS)}h` : `${Math.floor(ms / HOUR_MS)}h ${minutes}m`;
  }
  return `${Math.round(ms / DAY_MS)}d`;
}

function sliceOf(todo: Todo): Slice | null {
  if (todo.state === 'dismissed') return 'dismissed';
  const answer = todo.answer;
  if (answer === null) return todo.state === 'open' ? 'open' : null;
  if (answer.deferred) return 'deferred';
  return answer.preset === true ? 'council' : 'you';
}

function isUnanimous(todo: Todo): boolean {
  const picks = todo.positions.map((position) => position.optionId).filter((id) => id !== undefined);
  return picks.length > 1 && picks.every((id) => id === picks[0]);
}

function hasCouncilView(todo: Todo): boolean {
  return todo.positions.filter((position) => position.optionId !== undefined).length > 1;
}

function averageDecisionTime(runs: Run[]): number | null {
  const times = runs.flatMap((run) =>
    run.todos
      .filter((todo) => todo.kind !== 'finding' && todo.answer !== null && todo.answer.preset !== true)
      .map((todo) => new Date((todo.answer as NonNullable<Todo['answer']>).answeredAt).getTime() - new Date(run.createdAt).getTime()),
  );
  if (times.length === 0) return null;
  return times.reduce((sum, ms) => sum + Math.max(0, ms), 0) / times.length;
}

const COUNT_UP_MS = 400;
const MAX_HISTORY = 8;

function useCountUp(target: number): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  const current = useRef(shown);
  useEffect(() => {
    if (prefersReducedMotion()) {
      current.current = target;
      setShown(target);
      return;
    }
    const origin = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / COUNT_UP_MS);
      const value = Math.round(origin + (target - origin) * (1 - (1 - progress) ** 3));
      current.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

function Tile({ label, count, today, onClick }: { label: string; count: number; today?: number; onClick: () => void }) {
  const shown = useCountUp(count);
  return (
    <button className="tile" data-zero={count === 0} onClick={onClick}>
      <span className="tile-main">
        <span className="tile-count">{shown}</span>
        <span className="tile-label">{label}</span>
      </span>
      {today !== undefined && today > 0 ? <span className="tile-delta">+{today} today</span> : null}
    </button>
  );
}

function isToday(iso: string | undefined): boolean {
  return iso !== undefined && new Date(iso).toDateString() === new Date().toDateString();
}

function SplitBar<S extends string>(props: {
  slices: { id: S; label: string; color: string }[];
  counts: Map<S, number>;
  label: string;
  hideWhenZero: S[];
}) {
  const total = [...props.counts.values()].reduce((sum, n) => sum + n, 0);
  return (
    <>
      <div className="split-bar" role="img" aria-label={props.label}>
        {props.slices.map((slice) => {
          const n = props.counts.get(slice.id) ?? 0;
          return n > 0 ? <span key={slice.id} style={{ flex: n, background: slice.color }} title={`${slice.label} · ${n}`} /> : null;
        })}
        {total === 0 ? <span style={{ flex: 1 }} /> : null}
      </div>
      <div className="split-legend">
        {props.slices.map((slice) => {
          const n = props.counts.get(slice.id) ?? 0;
          if (n === 0 && props.hideWhenZero.includes(slice.id)) return null;
          return (
            <span key={slice.id} className="legend-item" data-zero={n === 0}>
              <i style={{ background: slice.color }} />
              {slice.label} <b>{n}</b>
            </span>
          );
        })}
      </div>
    </>
  );
}

function tally<S extends string>(todos: Todo[], sliceOf: (todo: Todo) => S | null): Map<S, number> {
  const counts = new Map<S, number>();
  todos.forEach((todo) => {
    const slice = sliceOf(todo);
    if (slice !== null) counts.set(slice, (counts.get(slice) ?? 0) + 1);
  });
  return counts;
}

function findingSliceOf(todo: Todo): FindingSlice | null {
  if (todo.state === 'open') return 'review';
  if (todo.state === 'understood') return 'understood';
  if (todo.state === 'answered' || todo.state === 'submitted' || todo.state === 'picked_up') return 'queued';
  if (todo.state === 'commented') return 'commented';
  if (todo.state === 'dropped') return 'dropped';
  return null;
}

function blockKind(todo: Todo): string {
  if (todo.state === 'open') return 'open';
  if (todo.state === 'answered') return todo.answer?.preset === true ? 'council' : 'answered';
  if (todo.state === 'submitted' || todo.state === 'picked_up') return 'sent';
  if (todo.state === 'understood' || todo.state === 'commented') return 'done';
  if (todo.state === 'dropped') return 'dismissed';
  return todo.state;
}

function BlockLegend() {
  return (
    <div className="block-legend">
      <span>
        <i className="block open" />
        needs you
      </span>
      <span>
        <i className="block answered" />
        answered
      </span>
      <span>
        <i className="block council" />
        council pick
      </span>
      <span>
        <i className="block sent" />
        sent
      </span>
      <span>
        <i className="block done" />
        done
      </span>
    </div>
  );
}

function RunRow({ run, now, onOpenTodo }: { run: Run; now: number; onOpenTodo: (key: string) => void }) {
  const done = run.todos.filter((todo) => todo.state === 'done').length;
  const total = run.todos.length;
  return (
    <div className="run-line">
      <span className="chip skill">{run.skill}</span>
      <span className="run-line-title">{run.title}</span>
      <span className="blocks">
        {run.todos.map((todo) => (
          <button
            key={todo.id}
            className={`block ${blockKind(todo)}`}
            title={`${todo.id} · ${todo.title} · ${todo.state}`}
            aria-label={`${todo.id} · ${todo.title} · ${todo.state}`}
            onClick={() => onOpenTodo(`${run.runId}/${todo.id}`)}
          />
        ))}
      </span>
      <span className="run-line-count mono">
        {done}/{total}
      </span>
      <span className="run-line-status" data-status={run.status}>
        {run.status}
      </span>
      <span className="run-line-time">{relativeTime(run.updatedAt, now)}</span>
    </div>
  );
}

function OverviewHeader({ thread, now }: { thread: Thread; now: number }) {
  return (
      <header className="overview-head">
          <div>
            <div className="title-row">
              <h2>{thread.displayName}</h2>
              <ModeTag mode={thread.mode} pr={thread.pr} />
            </div>
            <p className="muted">{thread.description}</p>
            {thread.summary !== '' ? <p className="overview-summary">{thread.summary}</p> : null}
          </div>
          <div className="overview-live">
            <span className={`dot dot-${thread.live}`} />
            <span>{LIVE_TEXT[thread.live]}</span>
            <span className="muted">· updated {relativeTime(thread.updatedAt, now)}</span>
            {thread.live === 'working' && thread.step !== null ? <span className="muted overview-step">· Now: {thread.step.text}</span> : null}
          </div>
      </header>
  );
}

function AgentsSection({ thread }: { thread: Thread }) {
  return (
      <section>
          <div className="section-title">
            <h3>Agents</h3>
            {thread.live === 'working' ? <span className="pill-working">Working now</span> : null}
          </div>
          <div className="agent-row">
            {thread.agents.map((agent) => (
              <div key={agent.id} className="agent-chip">
                <Avatar agent={agent} size={40} />
                <span>{ROLE_NAMES[avatarKindOf(agent)]}</span>
              </div>
            ))}
          </div>
      </section>
  );
}

function RunningOverview({ thread, now }: { thread: Thread; now: number }) {
  const history = [...thread.steps].reverse().slice(0, MAX_HISTORY);
  const orchestrator = thread.agents.find((agent) => agent.role === 'orchestrator');
  return (
    <div className="detail-scroll">
      <div className="overview">
        <OverviewHeader thread={thread} now={now} />
        <section className="running">
          {thread.step !== null ? <div className="running-now">Now: {thread.step.text}</div> : null}
          <p className="muted">No decisions yet. They will appear here when the agents need you.</p>
        </section>
        <AgentsSection thread={thread} />
        {history.length > 0 ? (
          <section>
            <h3>Recent steps</h3>
            <div className="step-list">
              {history.map((step) => {
                const agent = thread.agents.find((candidate) => candidate.id === (step.agent ?? orchestrator?.id));
                return (
                  <div key={`${step.at}-${step.text}`} className="step-line">
                    {agent !== undefined ? <Avatar agent={agent} size={20} /> : null}
                    <span className="step-text">{step.text}</span>
                    <span className="step-time">{relativeTime(step.at, now)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function Overview(props: { thread: Thread; now: number; onTab: (tab: Tab) => void; onOpenTodo: (key: string) => void }) {
  const { thread, now, onTab } = props;
  if (thread.runs.length === 0) return <RunningOverview thread={thread} now={now} />;
  const todos = thread.runs.flatMap((run) => run.todos);
  const findings = todos.filter((todo) => todo.kind === 'finding');
  const decisions = todos.filter((todo) => todo.kind !== 'finding');
  const count = (state: Todo['state']) => decisions.filter((todo) => todo.state === state).length;
  const findingCount = (matches: (todo: Todo) => boolean) => findings.filter(matches).length;
  const councilViews = decisions.filter(hasCouncilView);
  const average = averageDecisionTime(thread.runs);
  return (
    <div className="detail-scroll">
      <div className="overview">
        <OverviewHeader thread={thread} now={now} />
        {decisions.length > 0 ? (
          <section className="tiles">
            <Tile label="Needs you" count={count('open')} onClick={() => onTab('open')} />
            <Tile label="Ready to submit" count={decisions.filter(isReadyToSubmit).length} onClick={() => onTab('open')} />
            <Tile label="Waiting for agent" count={decisions.filter(isAwaitingPickup).length} onClick={() => onTab('progress')} />
            <Tile label="Agent working on it" count={count('picked_up')} onClick={() => onTab('progress')} />
            <Tile
              label="Done"
              count={count('done')}
              today={decisions.filter((todo) => todo.state === 'done' && isToday(todo.doneAt)).length}
              onClick={() => onTab('all')}
            />
            <Tile label="Council picks" count={decisions.filter((todo) => todo.category === 'key-decision').length} onClick={() => onTab('all')} />
          </section>
        ) : null}
        {findings.length > 0 ? (
          <section className="tiles five">
            <Tile label="To review" count={findingCount((todo) => todo.state === 'open')} onClick={() => onTab('open')} />
            <Tile label="Understood" count={findingCount((todo) => todo.state === 'understood')} onClick={() => onTab('all')} />
            <Tile
              label="Comments queued"
              count={findingCount((todo) => findingSliceOf(todo) === 'queued')}
              onClick={() => onTab('open')}
            />
            <Tile label="Commented" count={findingCount((todo) => todo.state === 'commented')} onClick={() => onTab('all')} />
            <Tile label="Dropped" count={findingCount((todo) => todo.state === 'dropped')} onClick={() => onTab('all')} />
          </section>
        ) : null}
        {decisions.length > 0 ? (
          <section>
            <h3>Decisions</h3>
            <SplitBar slices={SLICES} counts={tally(decisions, sliceOf)} label="Decisions split" hideWhenZero={['deferred', 'dismissed']} />
            <div className="split-facts">
              {councilViews.length > 0 ? (
                <span>
                  Council agreed on {councilViews.filter(isUnanimous).length} of {councilViews.length} decisions
                </span>
              ) : null}
              {average !== null ? <span>Avg time to decide: {formatDuration(average)}</span> : null}
            </div>
          </section>
        ) : null}
        {findings.length > 0 ? (
          <section>
            <h3>Findings</h3>
            <SplitBar slices={FINDING_SLICES} counts={tally(findings, findingSliceOf)} label="Findings split" hideWhenZero={[]} />
          </section>
        ) : null}
        <AgentsSection thread={thread} />
        <section>
          <div className="section-title">
            <h3>Runs</h3>
            <BlockLegend />
          </div>
          <div className="run-lines">
            {[...thread.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((run) => (
              <RunRow key={run.runId} run={run} now={now} onOpenTodo={props.onOpenTodo} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
