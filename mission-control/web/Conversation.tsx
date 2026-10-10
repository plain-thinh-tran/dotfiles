import type { Agent, Todo } from '../src/types';
import { Avatar } from './Avatar';
import { formatStamp } from './History';

export function Conversation({ messages, agents }: { messages: NonNullable<Todo['conversation']>; agents: Agent[] }) {
  const agent = agents.find((candidate) => candidate.role === 'orchestrator') ?? agents[0];
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
    </div>
  );
}
