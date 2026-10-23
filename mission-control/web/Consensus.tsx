import { useState } from 'react';
import type { Agent, Position } from '../src/types';
import { Avatar } from './Avatar';
import { alsoRaisedLine, consensusLine, stanceWord } from './reviewerText';

type ConsensusProps = {
  positions: Position[];
  alsoRaisedAs: string[];
  agents: Agent[];
};

function agentFor(agents: Agent[], id: string): Agent {
  return agents.find((agent) => agent.id === id) ?? { id, name: id, role: 'council', harness: 'other', model: '' };
}

function Reasoning({ positions, agents }: { positions: Position[]; agents: Agent[] }) {
  return (
    <div className="said">
      {positions.map((position) => (
        <div key={position.agent} className="said-row">
          <Avatar agent={agentFor(agents, position.agent)} size={20} />
          <div>
            <b>{agentFor(agents, position.agent).name}</b> <span className="muted">{position.summary}</span>
            {position.reason !== undefined && position.reason !== '' ? <p className="muted">{position.reason}</p> : null}
            {position.evidence !== undefined && position.evidence.length > 0 ? (
              <div className="said-evidence">
                {position.evidence.map((ref) => (
                  <span key={ref} className="ref mono">
                    {ref}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Consensus({ positions, alsoRaisedAs, agents }: ConsensusProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="consensus">
      <p className="consensus-line">{consensusLine(positions, agents)}</p>
      <div className="consensus-seats">
        {positions.map((position) => {
          const agent = agentFor(agents, position.agent);
          return (
            <span key={position.agent} className={`consensus-seat stance-${position.stance}`}>
              <Avatar agent={agent} size={18} />
              <span>{agent.name}</span>
              <span className="muted">{stanceWord(position.stance)}</span>
            </span>
          );
        })}
      </div>
      {alsoRaisedAs.length > 0 ? <p className="consensus-also muted">{alsoRaisedLine(alsoRaisedAs, agents)}</p> : null}
      <button className="link link-inline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide reasoning' : 'Show reasoning'}
      </button>
      {open ? <Reasoning positions={positions} agents={agents} /> : null}
    </div>
  );
}
