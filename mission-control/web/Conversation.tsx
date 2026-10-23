import { useEffect, useState } from 'react';
import type { Agent, Todo } from '../src/types';
import { questionPatienceMs } from '../src/prompt';
import { Avatar } from './Avatar';
import { formatStamp } from './History';

type Message = NonNullable<Todo['conversation']>[number];

function pendingMessage(messages: Message[]): Message | undefined {
  const latest = [...messages].reverse().find((message) => message.from === 'thinh');
  return latest?.pending === true ? latest : undefined;
}

type ConversationProps = {
  messages: Message[];
  agents: Agent[];
  instantAsk: boolean;
  dead: boolean;
  onRetry: () => void;
};

function typingNote(message: Message, instantAsk: boolean): string {
  if (message.answerer === 'notes') return "Looking it up with this review's notes… (about 30s)";
  if (message.answerer === 'session') return 'Asking a copy of the session…';
  return instantAsk ? 'Asking the agent…' : 'Asking a copy of the session…';
}

function Unanswered({ failed, dead, onRetry }: { failed: boolean; dead: boolean; onRetry: () => void }) {
  if (!failed && !dead) return <div className="no-quick-answer">No quick answer yet, the agent will see it with your next Submit</div>;
  return (
    <div className="no-quick-answer">
      <span>Couldn't get an answer</span>
      <button className="link link-inline" onClick={onRetry}>
        Retry
      </button>
      {dead ? null : <span>or the agent will see it with your next Submit</span>}
    </div>
  );
}

export function Conversation({ messages, agents, instantAsk, dead, onRetry }: ConversationProps) {
  const agent = agents.find((candidate) => candidate.role === 'orchestrator') ?? agents[0];
  const pending = pendingMessage(messages);
  const pendingAt = pending?.at;
  const patienceMs = pending === undefined ? 0 : questionPatienceMs(pending);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (pendingAt === undefined) return;
    const remaining = new Date(pendingAt).getTime() + patienceMs - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), remaining);
    return () => clearTimeout(timer);
  }, [pendingAt, patienceMs]);
  const failed = pending?.fallbackFailed === true;
  const waiting = pending !== undefined && !failed && Date.now() - new Date(pending.at).getTime() < patienceMs;
  return (
    <div className="conversation">
      {messages.map((message, index) => (
        <div key={index} className="message" data-from={message.from}>
          {message.from === 'agent' && agent !== undefined ? <Avatar agent={agent} size={22} /> : null}
          <div className="bubble">
            <span>{message.text}</span>
            <small>{formatStamp(message.at)}</small>
          </div>
        </div>
      ))}
      {pending !== undefined && waiting ? (
        <div className="message" data-from="agent">
          {agent !== undefined ? <Avatar agent={agent} size={22} /> : null}
          <div className="bubble typing" role="status" aria-label="The agent is typing">
            <i />
            <i />
            <i />
            <span className="typing-note">{typingNote(pending, instantAsk)}</span>
          </div>
        </div>
      ) : null}
      {pending !== undefined && !waiting ? <Unanswered failed={failed || dead} dead={dead} onRetry={onRetry} /> : null}
    </div>
  );
}
