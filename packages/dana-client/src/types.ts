export interface WorkUnitSummary {
  id: string;
  title: string;
  spec?: string;
  checkpoint?: boolean;
}

export interface TaskSummary {
  id: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  currentWuIndex: number;
  attempt: number;
  workUnits: WorkUnitSummary[];
  events?: TaskEvent[];
}

export interface WorkUnit {
  id: string;
  title: string;
  spec: string;
  checkpoint: boolean;
}

export interface WuPhase {
  phase: string;
  provider?: string;
  duration?: number;
  filesChanged?: string[];
  inputTokens?: number;
  outputTokens?: number;
  tokenTotal?: number;
  agentPrompt?: string;
  agentResponse?: string;
}

export interface PlanReviewer {
  id: string;
  approved: boolean;
  findings: string[];
  provider?: string;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenTotal?: number;
  agentResponse?: string;
}

export interface WuResult {
  id: string;
  committed: boolean;
  implementAttempts: number;
  errors?: string[];
  reviewPassed?: boolean;
  phases?: WuPhase[];
}

export interface Checkpoint {
  wuId: string;
  phase: string;
  reason: string;
  prompt: string;
}

export interface TaskEvent {
  type: string;
  phase?: string;
  ts: string;
  verdict?: string;
  message?: string;
  wuId?: string;
  reviewer?: string;
  approved?: boolean;
  findings?: string[];
  provider?: string;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenTotal?: number;
  agentPrompt?: string;
  agentResponse?: string;
  wu?: string;
  filesChanged?: string[];
  commitHash?: string;
  output?: string;
  phases?: WuPhase[];
  planReview?: PlanReviewer[];
}

export interface TaskDetail {
  id: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  currentWuIndex: number;
  attempt: number;
  workUnits: WorkUnit[];
  wuResults: WuResult[];
  checkpoint: Checkpoint | null;
  events: TaskEvent[];
}

export interface WorkUnitInput {
  id?: string;
  title: string;
  spec: string;
  checkpoint?: boolean;
}

export interface CreateTaskInput {
  goal: string;
  workUnits?: WorkUnitInput[];
  tags?: string[];
}

export interface CheckpointSummary {
  taskId: string;
  wuId: string;
  phase: string;
  reason: string;
  prompt: string;
}

export interface HealthResponse {
  status: string;
  uptime?: number;
}

export interface DanaConfig {
  provider?: string;
  checkpointSettings?: Record<string, unknown>;
}
