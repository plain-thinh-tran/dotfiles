export type AgentRole = 'orchestrator' | 'council' | 'reviewer' | 'worker' | 'scout';

export type Agent = {
  id: string;
  name: string;
  role: AgentRole;
  harness: 'claude' | 'codex' | 'cursor' | 'other';
  model: string;
};

export type TodoKind = 'decision' | 'question' | 'approval' | 'finding';

export type TodoCategory = 'needs-you' | 'key-decision';

export type TodoState =
  | 'open'
  | 'answered'
  | 'submitted'
  | 'picked_up'
  | 'done'
  | 'dismissed'
  | 'understood'
  | 'commented'
  | 'dropped';

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
  question?: boolean;
  comment?: true;
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
  doneAt?: string;
  diffs?: { path: string; patch: string }[];
  severity?: string;
  verification?: string;
  draftComment?: string;
  suggestedQuestions?: string[];
  conversation?: {
    from: 'thinh' | 'agent';
    text: string;
    at: string;
    pending?: boolean;
    fallbackFailed?: boolean;
    submittedAt?: string;
    deliveredAt?: string;
  }[];
};

export type Session = {
  conductorSessionId: string;
  workspacePath: string;
  workspaceName: string;
  repo: string;
  branch: string;
  pr: { number: number; url: string } | null;
};

export type RunMode = 'build' | 'review' | 'self-check';

export type RunPr = { number: number; url: string; author: string };

export type Run = {
  version: 1;
  runId: string;
  skill: string;
  title: string;
  summary?: string;
  mode?: RunMode;
  pr?: RunPr;
  status: 'active' | 'done';
  createdAt: string;
  updatedAt: string;
  session: Session;
  agents: Agent[];
  todos: Todo[];
  submissions: { id: string; at: string; todoIds: string[]; questionTodoIds?: string[] }[];
};

export type LiveState = 'working' | 'waiting_on_you' | 'idle' | 'dead' | 'error';

export type Thread = {
  sessionId: string;
  session: Session;
  archived: boolean;
  instantAsk: boolean;
  mode: RunMode;
  pr: RunPr | null;
  displayName: string;
  description: string;
  summary: string;
  live: LiveState;
  step: { text: string; at: string; agent: string | null } | null;
  steps: { text: string; at: string; agent: string | null }[];
  agents: Agent[];
  runs: Run[];
  openCount: number;
  answeredCount: number;
  updatedAt: string;
};
