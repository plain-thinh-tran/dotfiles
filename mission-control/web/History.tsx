import { voteCounts } from '../src/council';
import { chosenLabel } from '../src/prompt';
import type { Agent, Run, Todo } from '../src/types';

type HistoryEvent = { key: string; label: string; at: string | null; href?: string };

export function formatStamp(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function raisedBy(todo: Todo, agents: Agent[]): string {
  const author = agents.find((agent) => agent.id === todo.recommendation?.by) ?? agents.find((agent) => agent.role === 'orchestrator');
  return author?.name ?? 'the orchestrator';
}

function councilResult(todo: Todo): string | null {
  const votes = voteCounts(todo.positions);
  if (votes.reduce((sum, n) => sum + n, 0) < 2) return null;
  if (votes.length === 1) return 'Council agreed';
  if (votes.length >= 3 && votes.every((n) => n === 1)) return `Council split ${votes.length} ways`;
  return `Council split ${votes.join(' to ')}`;
}

function isUrl(text: string | null): text is string {
  return text !== null && /^https?:\/\//.test(text);
}

function findingEvents(todo: Todo): (HistoryEvent | null)[] {
  const queued = todo.answer?.comment === true;
  const settled = todo.doneAt ?? null;
  return [
    queued ? { key: 'queued', label: 'Comment queued', at: todo.answer?.answeredAt ?? null } : null,
    todo.state === 'understood' ? { key: 'understood', label: 'Understood', at: settled } : null,
    todo.state === 'dropped' ? { key: 'dropped', label: 'Dropped', at: settled } : null,
    todo.state === 'commented'
      ? {
          key: 'commented',
          label: 'Commented',
          at: settled,
          ...(isUrl(todo.resolution) ? { href: todo.resolution } : {}),
        }
      : null,
  ];
}

function answerEvent(todo: Todo): HistoryEvent | null {
  const answer = todo.answer;
  if (answer === null || todo.kind === 'finding') return null;
  if (answer.preset === true) return { key: 'answer', label: 'Council pick kept', at: answer.answeredAt };
  if (answer.deferred) return { key: 'answer', label: 'Deferred', at: answer.answeredAt };
  const label = chosenLabel(todo);
  return { key: 'answer', label: label === 'answered' ? 'You answered' : `You answered: ${label}`, at: answer.answeredAt };
}

function eventsOf(run: Run, todo: Todo, agents: Agent[]): HistoryEvent[] {
  const finding = todo.kind === 'finding';
  const council = finding ? null : councilResult(todo);
  const answered = answerEvent(todo);
  const conversation = (todo.conversation ?? []).map(
    (message, index): HistoryEvent => ({
      key: `message-${index}`,
      label: message.from === 'thinh' ? `You asked: ${message.text}` : 'Agent replied',
      at: message.at,
    }),
  );
  const events: (HistoryEvent | null)[] = [
    { key: 'raised', label: `Raised by ${raisedBy(todo, agents)}`, at: run.createdAt },
    council === null ? null : { key: 'council', label: council, at: run.createdAt },
    ...conversation,
    answered,
    todo.state === 'dismissed' ? { key: 'dismissed', label: 'Dismissed', at: null } : null,
    ...(finding ? findingEvents(todo) : []),
    todo.submittedAt === null ? null : { key: 'sent', label: 'Sent', at: todo.submittedAt },
    todo.pickedUpAt === null ? null : { key: 'picked', label: 'Agent picked it up', at: todo.pickedUpAt },
    todo.state === 'done'
      ? { key: 'done', label: todo.resolution === null ? 'Done' : `Done: ${todo.resolution}`, at: todo.doneAt ?? null }
      : null,
  ];
  return events.filter((event): event is HistoryEvent => event !== null);
}

export function History({ run, todo, agents }: { run: Run; todo: Todo; agents: Agent[] }) {
  const events = eventsOf(run, todo, agents);
  return (
    <div className="history">
      {events.map((event, index) => (
        <div key={event.key} className="history-event" data-latest={index === events.length - 1}>
          {event.href === undefined ? event.label : (
            <a href={event.href} target="_blank" rel="noreferrer">
              {event.label}
            </a>
          )}
          {event.at !== null ? <small>{formatStamp(event.at)}</small> : null}
        </div>
      ))}
    </div>
  );
}
