export type AgentRole = 'orchestrator' | 'council' | 'reviewer' | 'worker' | 'scout';

export type Agent = {
  id: string;
  name: string;
  role: AgentRole;
  harness: 'claude' | 'codex' | 'cursor' | 'other';
  model: string;
};

export type TodoKind = 'decision' | 'question' | 'approval';

export type TodoCategory = 'needs-you' | 'key-decision';

export type TodoState = 'open' | 'answered' | 'submitted' | 'picked_up' | 'done' | 'dismissed';

export type Option = {
  id: string;
  label: string;
  description?: string;
};

export type Position = {
  agent: string;
  stance: string;
  optionId?: string;
  summary: string;
  reason?: string;
  evidence?: string[];
};

export type Evidence = {
  ref: string;
  note?: string;
};

export type Answer = {
  optionId: string | null;
  text: string;
  deferred: boolean;
  answeredAt: string;
  preset?: boolean;
};

export type Todo = {
  id: string;
  kind: TodoKind;
  category: TodoCategory;
  title: string;
  question: string;
  recommendation: { by: string; optionId?: string; summary: string } | null;
  options: Option[];
  positions: Position[];
  tradeoffs: string[];
  caveats: string[];
  evidence: Evidence[];
  links: { label: string; url: string }[];
  state: TodoState;
  answer: Answer | null;
  submittedAt: string | null;
  pickedUpAt: string | null;
  resolution: string | null;
};

export type Session = {
  conductorSessionId: string;
  workspacePath: string;
  workspaceName: string;
  repo: string;
  branch: string;
  pr: { number: number; url: string } | null;
};

export type Run = {
  version: 1;
  runId: string;
  skill: string;
  title: string;
  status: 'active' | 'done';
  createdAt: string;
  updatedAt: string;
  session: Session;
  agents: Agent[];
  todos: Todo[];
  submissions: { id: string; at: string; todoIds: string[] }[];
};

export type LiveState = 'working' | 'waiting_on_you' | 'idle' | 'dead' | 'error';

export type Thread = {
  sessionId: string;
  session: Session;
  live: LiveState;
  agents: Agent[];
  runs: Run[];
  openCount: number;
  answeredCount: number;
  updatedAt: string;
};
