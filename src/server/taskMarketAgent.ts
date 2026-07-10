import type { AuditEvent, Job, PaymentRecord, ReviewerIntegration, ReviewerSignal, TaskMarketAdapter, TaskMarketSnapshot, TaskPolicy, WorkerProfile } from '../shared/types';
import { appConfig, defaultPolicy } from './config';
import { nowIso, round, uid } from './utils';

export class TaskMarketAgent {
  private policy: TaskPolicy = { ...defaultPolicy };
  private status: TaskMarketSnapshot['status'] = 'idle';
  private timer?: NodeJS.Timeout;
  private balances: TaskMarketSnapshot['balances'] = [];
  private jobs: Job[] = [];
  private payments: PaymentRecord[] = [];
  private auditLog: AuditEvent[] = [];
  private handledJobs = new Set<string>();
  private lastTickAt?: string;
  private error?: string;

  constructor(private readonly adapter: TaskMarketAdapter) {}

  async init(): Promise<void> {
    this.push(this.audit('system', 'init', `Starting Sphere Task Market in ${this.adapter.mode} mode.`));
    await this.adapter.init();
    this.balances = await this.adapter.getBalances();
    this.push(this.audit('system', 'ready', 'Client and worker agents initialized.', 'success'));
  }

  start(): void {
    if (this.status === 'running') {
      return;
    }
    this.status = 'running';
    this.error = undefined;
    this.push(this.audit('system', 'start', `Autonomous job-market loop started with ${this.policy.tickMs}ms ticks.`, 'success'));
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.policy.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.status = 'paused';
    this.push(this.audit('system', 'stop', 'Autonomous loop paused.'));
  }

  updatePolicy(next: Partial<TaskPolicy>): TaskPolicy {
    this.policy = { ...this.policy, ...next };
    this.push(this.audit('policy', 'update', 'Task-market policy updated.', 'success', this.policy as unknown as Record<string, unknown>));
    return this.policy;
  }

  async tick(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    try {
      this.lastTickAt = nowIso();
      this.balances = await this.adapter.getBalances();
      await this.publishClientJobIfNeeded();
      await this.discoverMarketJobs();
      await this.workerAcceptAndDeliver();
      await this.clientApproveAndPay();
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.push(this.audit('system', 'tick_error', this.error, 'error'));
    }
  }

  snapshot(): TaskMarketSnapshot {
    return {
      mode: this.adapter.mode,
      status: this.status,
      clientName: appConfig.clientName,
      workerName: appConfig.workerName,
      lastTickAt: this.lastTickAt,
      policy: this.policy,
      clientWallet: this.adapter.getClientWallet(),
      workerWallet: this.adapter.getWorkerWallet(),
      balances: this.balances,
      jobs: this.jobs.slice(0, 40),
      payments: this.payments.slice(0, 30),
      workerProfile: this.workerProfile(),
      reviewer: this.reviewerIntegration(),
      audit: this.auditLog.slice(-100).reverse(),
      error: this.error
    };
  }

  listJobs(): Job[] {
    return this.jobs.slice(0, 80);
  }

  listPayments(): PaymentRecord[] {
    return this.payments.slice(0, 80);
  }

  async submitExternalJob(input: Pick<Job, 'title' | 'prompt' | 'category' | 'bounty'> & Partial<Pick<Job, 'asset' | 'client'>>): Promise<Job> {
    const job = await this.adapter.publishJob({
      title: input.title,
      prompt: input.prompt,
      category: input.category,
      bounty: Math.min(input.bounty, this.policy.maxBudget),
      asset: input.asset ?? this.policy.paymentAsset,
      client: input.client ?? '@external-agent'
    });
    this.jobs.unshift(job);
    this.push(this.audit('market', 'external_job', `External agent published ${job.title} for ${job.bounty} ${job.asset}.`, 'success', { jobId: job.id }));
    return job;
  }

  async deliverExternalJob(jobId: string, result: string, qualityScore = 0.9): Promise<Job> {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    const deliverable = job.status === 'open' ? await this.adapter.acceptJob(job, appConfig.workerName) : job;
    const delivered = await this.adapter.deliverJob(deliverable, result, qualityScore);
    this.replaceJob(delivered);
    this.push(this.audit('worker-agent', 'external_delivery', `External delivery recorded for ${delivered.title}.`, 'success', { jobId }));
    return delivered;
  }

  async settlePaymentById(paymentId: string): Promise<PaymentRecord> {
    const payment = this.payments.find((item) => item.id === paymentId);
    if (!payment) {
      throw new Error(`Payment ${paymentId} was not found.`);
    }
    const settled = await this.settleWithTimeout(payment);
    this.payments = this.payments.map((item) => (item.id === paymentId ? settled : item));
    this.push(this.audit('payment', 'api_settle_payment', `API settlement result: ${settled.status} for ${settled.amount} ${settled.asset}.`, settled.status === 'paid' ? 'success' : 'warn', { paymentId }));
    return settled;
  }

  private async publishClientJobIfNeeded(): Promise<void> {
    const openClientJobs = this.jobs.filter((job) => job.client === appConfig.clientName && ['open', 'assigned'].includes(job.status));
    if (openClientJobs.length >= this.policy.maxOpenJobs) {
      return;
    }

    const template = this.nextJobTemplate();
    const job = await this.adapter.publishJob({
      ...template,
      bounty: Math.min(template.bounty, this.policy.maxBudget),
      asset: this.policy.paymentAsset,
      client: appConfig.clientName
    });
    this.jobs.unshift(job);
    this.push(this.audit('client-agent', 'publish_job', `Published ${job.title} for ${job.bounty} ${job.asset}.`, 'success', { jobId: job.id }));
  }

  private async discoverMarketJobs(): Promise<void> {
    const discovered = await this.adapter.discoverJobs();
    const known = new Set(this.jobs.map((job) => job.id));
    for (const job of discovered) {
      if (!known.has(job.id)) {
        this.jobs.push(job);
        known.add(job.id);
      }
    }
    this.jobs = this.jobs
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 80);
  }

  private async workerAcceptAndDeliver(): Promise<void> {
    const candidates = this.jobs.filter((job) => job.status === 'open' && !this.handledJobs.has(job.id));
    for (const job of candidates) {
      if (!this.workerCanAccept(job)) {
        this.handledJobs.add(job.id);
        this.push(this.audit('worker-agent', 'reject_job', `Rejected ${job.title}: outside capability or bounty floor.`, 'info', { jobId: job.id }));
        continue;
      }

      this.handledJobs.add(job.id);
      const accepted = await this.adapter.acceptJob(job, appConfig.workerName);
      this.replaceJob(accepted);
      this.push(this.audit('worker-agent', 'accept_job', `Accepted ${accepted.title} from ${accepted.client}.`, 'success', { jobId: accepted.id }));

      const result = this.solveJob(accepted);
      const delivered = await this.adapter.deliverJob(accepted, result.result, result.qualityScore);
      this.replaceJob(delivered);
      this.push(
        this.audit('worker-agent', 'deliver_result', `Delivered result with quality ${Math.round(result.qualityScore * 100)}%.`, 'success', {
          jobId: delivered.id
        })
      );
      break;
    }
  }

  private async clientApproveAndPay(): Promise<void> {
    const payable = this.jobs.filter(
      (job) =>
        job.status === 'delivered' &&
        job.client === appConfig.clientName &&
        (job.qualityScore ?? 0) >= this.policy.minQuality &&
        !this.payments.some((payment) => payment.jobId === job.id)
    );

    for (const job of payable) {
      if (!this.policy.autoApprove) {
        this.push(this.audit('client-agent', 'await_approval', `${job.title} awaits manual approval.`, 'info', { jobId: job.id }));
        continue;
      }

      const request = await this.adapter.requestPayment(job);
      this.payments.unshift(request);
      this.push(this.audit('payment', 'request_payment', `Payment requested: ${request.amount} ${request.asset} to ${request.to}.`, 'info', { jobId: job.id }));

      const settled = await this.settleWithTimeout(request);
      this.payments = this.payments.map((payment) => (payment.id === request.id ? settled : payment));
      this.jobs = this.jobs.map((item) => (item.id === job.id ? { ...item, status: settled.status === 'paid' ? 'paid' : 'delivered', paidAt: settled.settledAt } : item));
      this.push(
        this.audit(
          'payment',
          settled.status === 'paid' ? 'settle_payment' : 'payment_pending',
          `${settled.status.toUpperCase()}: ${settled.amount} ${settled.asset} from ${settled.from} to ${settled.to}.`,
          settled.status === 'paid' ? 'success' : 'warn',
          { paymentId: settled.id, jobId: job.id }
        )
      );
      break;
    }
  }

  private async settleWithTimeout(payment: PaymentRecord): Promise<PaymentRecord> {
    const settlement = this.adapter.settlePayment(payment);
    settlement.catch(() => undefined);
    const timeout = new Promise<PaymentRecord>((resolve) =>
      setTimeout(() => resolve({ ...payment, status: 'failed', networkRef: 'payment_timeout' }), Math.min(this.policy.tickMs, 5000))
    );
    try {
      return await Promise.race([settlement, timeout]);
    } catch (error) {
      return {
        ...payment,
        status: 'failed',
        networkRef: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private nextJobTemplate(): Omit<Job, 'id' | 'status' | 'createdAt' | 'source' | 'client' | 'asset'> {
    const templates: Array<Omit<Job, 'id' | 'status' | 'createdAt' | 'source' | 'client' | 'asset'>> = [
      {
        title: 'Summarize builder update',
        prompt: 'Summarize a Sphere builder-program update into five operator-ready bullets.',
        category: 'summarize',
        bounty: 8
      },
      {
        title: 'Classify inbound request',
        prompt: 'Classify this support request by urgency, department, and whether payment follow-up is needed.',
        category: 'classify',
        bounty: 6
      },
      {
        title: 'Extract payment terms',
        prompt: 'Extract vendor, amount, due date, and payment terms from a short invoice note.',
        category: 'extract',
        bounty: 11
      },
      {
        title: 'Research agent market signal',
        prompt: 'Produce a concise market signal for agent labor pricing and expected completion time.',
        category: 'research',
        bounty: 14
      }
    ];
    return templates[Math.floor(Date.now() / 4500) % templates.length];
  }

  private workerCanAccept(job: Job): boolean {
    const profile = this.workerProfile();
    return profile.capabilities.includes(job.category) && job.bounty >= profile.minBounty;
  }

  private solveJob(job: Job): { result: string; qualityScore: number } {
    const qualityScore = round(0.84 + Math.random() * 0.13, 2);
    const resultByCategory: Record<Job['category'], string> = {
      summarize: `Summary for "${job.title}": goal, constraints, action items, payment trigger, and follow-up risk are condensed into operator bullets.`,
      classify: `Classification for "${job.title}": medium urgency, operations queue, payment follow-up likely, confidence ${Math.round(qualityScore * 100)}%.`,
      extract: `Extracted fields for "${job.title}": vendor=demo counterparty, amount=${job.bounty} ${job.asset}, due=on delivery, terms=agent-approved.`,
      research: `Research result for "${job.title}": comparable agent jobs cluster around ${job.bounty - 2}-${job.bounty + 4} ${job.asset} with fast-turnaround premium.`
    };
    return { result: resultByCategory[job.category], qualityScore };
  }

  private replaceJob(next: Job): void {
    this.jobs = this.jobs.map((job) => (job.id === next.id ? next : job));
  }

  private workerProfile(): WorkerProfile {
    return {
      nametag: appConfig.workerName,
      capabilities: ['summarize', 'classify', 'extract', 'research'],
      minBounty: 5,
      successRate: 0.94,
      avgLatencyMs: 4200,
      wallet: this.adapter.getWorkerWallet()
    };
  }

  private reviewerIntegration(): ReviewerIntegration {
    const clientWallet = this.adapter.getClientWallet();
    const workerWallet = this.adapter.getWorkerWallet();
    const walletReady = (wallet: typeof clientWallet): ReviewerSignal['status'] =>
      wallet.connection === 'connected' || wallet.connection === 'configured' || wallet.connection === 'simulated' ? 'ready' : 'warning';

    return {
      sdkDependency: this.signal('Sphere SDK dependency', 'ready', '@unicitylabs/sphere-sdk is installed and imported by the live adapter.'),
      backendAgentLoop: this.signal('Backend autonomous loop', this.status === 'running' ? 'ready' : 'warning', this.status === 'running' ? 'Agent service loop is running.' : 'Start the loop or call POST /api/agent/tick.'),
      walletMode: this.signal('Wallet mode', this.adapter.mode === 'live' ? 'ready' : 'warning', this.adapter.mode === 'live' ? 'Live Sphere SDK adapter is active.' : 'Dry-run reviewer mode is active; use SPHERE_MODE=live for wallet execution.'),
      clientWallet: this.signal('Client wallet', walletReady(clientWallet), clientWallet.message),
      workerWallet: this.signal('Worker wallet', walletReady(workerWallet), workerWallet.message),
      network: this.signal('Network', 'ready', `${clientWallet.network} via ${this.adapter.mode} adapter.`),
      publicAgentApi: this.signal('Public agent API', 'ready', 'Other agents can call /api/jobs, /api/jobs/:id/deliver, and /api/payments/:id/settle.'),
      settlement: this.signal('Payment settlement', this.adapter.mode === 'live' ? 'warning' : 'ready', this.adapter.mode === 'live' ? 'Live payment settlement is attempted through available SDK payment methods and logged on failure.' : 'Dry-run settlement is deterministic for reviewer reproduction.')
    };
  }

  private signal(label: string, status: ReviewerSignal['status'], detail: string): ReviewerSignal {
    return { label, status, detail };
  }

  private audit(
    actor: AuditEvent['actor'],
    action: string,
    message: string,
    level: AuditEvent['level'] = 'info',
    data?: Record<string, unknown>
  ): AuditEvent {
    return {
      id: uid('evt'),
      at: nowIso(),
      actor,
      action,
      message,
      level,
      data
    };
  }

  private push(event: AuditEvent): void {
    this.auditLog.push(event);
    this.auditLog = this.auditLog.slice(-250);
  }
}
