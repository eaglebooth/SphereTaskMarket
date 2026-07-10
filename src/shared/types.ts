export type AgentMode = 'dry-run' | 'live';
export type AgentStatus = 'idle' | 'running' | 'paused' | 'error';
export type JobStatus = 'open' | 'assigned' | 'delivered' | 'paid' | 'rejected' | 'expired';
export type PaymentStatus = 'requested' | 'paid' | 'failed' | 'simulated';

export interface TaskPolicy {
  maxBudget: number;
  minQuality: number;
  autoApprove: boolean;
  tickMs: number;
  paymentAsset: string;
  maxOpenJobs: number;
}

export interface WalletStatus {
  mode: AgentMode;
  connection: 'simulated' | 'configured' | 'connected' | 'missing' | 'offline';
  network: string;
  nametag: string;
  address?: string;
  hasMnemonic: boolean;
  walletApiSession?: 'online' | 'offline' | null;
  message: string;
}

export interface Balance {
  asset: string;
  available: number;
}

export interface Job {
  id: string;
  title: string;
  prompt: string;
  category: 'summarize' | 'classify' | 'extract' | 'research';
  bounty: number;
  asset: string;
  client: string;
  worker?: string;
  status: JobStatus;
  createdAt: string;
  assignedAt?: string;
  deliveredAt?: string;
  paidAt?: string;
  result?: string;
  qualityScore?: number;
  source: 'client' | 'worker' | 'market';
  networkRef?: string;
}

export interface WorkerProfile {
  nametag: string;
  capabilities: Job['category'][];
  minBounty: number;
  successRate: number;
  avgLatencyMs: number;
  wallet: WalletStatus;
}

export interface PaymentRecord {
  id: string;
  jobId: string;
  from: string;
  to: string;
  amount: number;
  asset: string;
  status: PaymentStatus;
  createdAt: string;
  settledAt?: string;
  networkRef?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  level: 'info' | 'success' | 'warn' | 'error';
  actor: 'client-agent' | 'worker-agent' | 'policy' | 'market' | 'payment' | 'system';
  action: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ReviewerSignal {
  label: string;
  status: 'ready' | 'warning' | 'blocked';
  detail: string;
}

export interface ReviewerIntegration {
  sdkDependency: ReviewerSignal;
  backendAgentLoop: ReviewerSignal;
  walletMode: ReviewerSignal;
  clientWallet: ReviewerSignal;
  workerWallet: ReviewerSignal;
  network: ReviewerSignal;
  publicAgentApi: ReviewerSignal;
  settlement: ReviewerSignal;
}

export interface TaskMarketSnapshot {
  mode: AgentMode;
  status: AgentStatus;
  clientName: string;
  workerName: string;
  lastTickAt?: string;
  policy: TaskPolicy;
  clientWallet: WalletStatus;
  workerWallet: WalletStatus;
  balances: Balance[];
  jobs: Job[];
  payments: PaymentRecord[];
  workerProfile: WorkerProfile;
  reviewer: ReviewerIntegration;
  audit: AuditEvent[];
  error?: string;
}

export interface TaskMarketAdapter {
  mode: AgentMode;
  init(): Promise<void>;
  getBalances(): Promise<Balance[]>;
  getClientWallet(): WalletStatus;
  getWorkerWallet(): WalletStatus;
  publishJob(job: Omit<Job, 'id' | 'status' | 'createdAt' | 'source'>): Promise<Job>;
  discoverJobs(): Promise<Job[]>;
  acceptJob(job: Job, worker: string): Promise<Job>;
  deliverJob(job: Job, result: string, qualityScore: number): Promise<Job>;
  requestPayment(job: Job): Promise<PaymentRecord>;
  settlePayment(payment: PaymentRecord): Promise<PaymentRecord>;
}
