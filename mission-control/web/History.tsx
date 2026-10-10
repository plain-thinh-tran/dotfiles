import { chosenLabel } from '../src/prompt';
import type { Agent, Run, Todo } from '../src/types';

type HistoryEvent = { key: string; label: string; at: string | null };

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
  const picks = todo.positions.map((position) => position.optionId).filter((id): id is string => id !== undefined);
  if (picks.length < 2) return null;
  const counts = new Map<string, number>();
  picks.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const [first = 0, second = 0] = [...counts.values()].sort((a, b) => b - a);
  return counts.size === 1 ? 'Council agreed' : `Council split ${first} to ${second}`;
}

function answerEvent(todo: Todo): HistoryEvent | null {
  const answer = todo.answer;
  if (answer === null) return null;
  if (answer.preset === true) return { key: 'answer', label: 'Council pick kept', at: answer.answeredAt };
  if (answer.deferred) return { key: 'answer', label: 'Deferred', at: answer.answeredAt };
  if (answer.question === true) return { key: 'asked-pending', label: `You asked: ${answer.text.trim()}`, at: answer.answeredAt };
  const label = chosenLabel(todo);
  return { key: 'answer', label: label === 'answered' ? 'You answered' : `You answered: ${label}`, at: answer.answeredAt };
}

function eventsOf(run: Run, todo: Todo, agents: Agent[]): HistoryEvent[] {
  const council = councilResult(todo);
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
          {event.label}
          {event.at !== null ? <small>{formatStamp(event.at)}</small> : null}
        </div>
      ))}
    </div>
  );
}
