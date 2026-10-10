import { useEffect, useState } from 'react';
import type { Agent, Todo } from '../src/types';
import { Avatar } from './Avatar';
import { formatStamp } from './History';

const QUICK_ANSWER_MS = 45000;
const FALLBACK_ANSWER_MS = 75000;

type Message = NonNullable<Todo['conversation']>[number];

function pendingMessage(messages: Message[]): Message | undefined {
  const latest = [...messages].reverse().find((message) => message.from === 'thinh');
  return latest?.pending === true ? latest : undefined;
}

export function Conversation({ messages, agents, instantAsk }: { messages: Message[]; agents: Agent[]; instantAsk: boolean }) {
  const patienceMs = instantAsk ? QUICK_ANSWER_MS : FALLBACK_ANSWER_MS;
  const agent = agents.find((candidate) => candidate.role === 'orchestrator') ?? agents[0];
  const pending = pendingMessage(messages);
  const pendingAt = pending?.at;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (pendingAt === undefined) return;
    const remaining = new Date(pendingAt).getTime() + patienceMs - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), remaining);
    return () => clearTimeout(timer);
  }, [pendingAt, patienceMs]);
  const waiting = pending !== undefined && Date.now() - new Date(pending.at).getTime() < patienceMs;
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
      {waiting ? (
        <div className="message" data-from="agent">
          {agent !== undefined ? <Avatar agent={agent} size={22} /> : null}
          <div className="bubble typing" role="status" aria-label="The agent is typing">
            <i />
            <i />
            <i />
            <span className="typing-note">{instantAsk ? 'Asking the agent…' : 'Asking a copy of the session… (about 10s)'}</span>
          </div>
        </div>
      ) : null}
      {pending !== undefined && !waiting ? (
        <div className="no-quick-answer">No quick answer yet, the agent will see it with your next Submit</div>
      ) : null}
    </div>
  );
}
