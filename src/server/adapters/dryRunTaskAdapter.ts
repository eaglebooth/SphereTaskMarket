import type { Balance, Job, PaymentRecord, TaskMarketAdapter, WalletStatus } from '../../shared/types';
import { appConfig } from '../config';
import { nowIso, round, uid } from '../utils';

export class DryRunTaskAdapter implements TaskMarketAdapter {
  mode = 'dry-run' as const;
  private balances: Balance[] = [
    { asset: 'UCT', available: 420 },
    { asset: 'ETH', available: 2.4 }
  ];
  private jobs: Job[] = [];
  private payments: PaymentRecord[] = [];

  async init(): Promise<void> {
    this.seedMarket();
  }

  async getBalances(): Promise<Balance[]> {
    return this.balances.map((balance) => ({ ...balance }));
  }

  getClientWallet(): WalletStatus {
    return {
      mode: 'dry-run',
      connection: 'simulated',
      network: 'testnet2',
      nametag: appConfig.clientName,
      hasMnemonic: false,
      message: 'Client agent wallet is simulated for instant reviewer demos.'
    };
  }

  getWorkerWallet(): WalletStatus {
    return {
      mode: 'dry-run',
      connection: 'simulated',
      network: 'testnet2',
      nametag: appConfig.workerName,
      hasMnemonic: false,
      message: 'Worker agent wallet is simulated but follows the same job/payment loop.'
    };
  }

  async publishJob(job: Omit<Job, 'id' | 'status' | 'createdAt' | 'source'>): Promise<Job> {
    const published: Job = {
      ...job,
      id: uid('job'),
      status: 'open',
      createdAt: nowIso(),
      source: 'client',
      networkRef: uid('intent')
    };
    this.jobs.unshift(published);
    this.jobs = this.jobs.slice(0, 60);
    return { ...published };
  }

  async discoverJobs(): Promise<Job[]> {
    this.maybeSeedExternalJob();
    return this.jobs.map((job) => ({ ...job }));
  }

  async acceptJob(job: Job, worker: string): Promise<Job> {
    const accepted: Job = {
      ...job,
      worker,
      status: 'assigned',
      assignedAt: nowIso()
    };
    this.jobs = this.jobs.map((item) => (item.id === job.id ? accepted : item));
    return { ...accepted };
  }

  async deliverJob(job: Job, result: string, qualityScore: number): Promise<Job> {
    const delivered: Job = {
      ...job,
      result,
      qualityScore,
      status: 'delivered',
      deliveredAt: nowIso()
    };
    this.jobs = this.jobs.map((item) => (item.id === job.id ? delivered : item));
    return { ...delivered };
  }

  async requestPayment(job: Job): Promise<PaymentRecord> {
    const payment: PaymentRecord = {
      id: uid('payreq'),
      jobId: job.id,
      from: job.client,
      to: job.worker ?? appConfig.workerName,
      amount: job.bounty,
      asset: job.asset,
      status: 'requested',
      createdAt: nowIso(),
      networkRef: uid('payment_request')
    };
    this.payments.unshift(payment);
    return { ...payment };
  }

  async settlePayment(payment: PaymentRecord): Promise<PaymentRecord> {
    const clientBalance = this.findBalance(payment.asset);
    clientBalance.available = round(clientBalance.available - payment.amount);

    const settled: PaymentRecord = {
      ...payment,
      status: 'paid',
      settledAt: nowIso(),
      networkRef: uid('drypay')
    };
    this.payments = this.payments.map((item) => (item.id === payment.id ? settled : item));
    this.jobs = this.jobs.map((job) =>
      job.id === payment.jobId ? { ...job, status: 'paid', paidAt: settled.settledAt } : job
    );
    return { ...settled };
  }

  private seedMarket(): void {
    if (this.jobs.length > 0) {
      return;
    }
    this.jobs = [
      this.externalJob('Summarize a grant update', 'Summarize this builder-program update into 5 bullets.', 'summarize', 8),
      this.externalJob('Classify support ticket', 'Classify this user issue by urgency and product area.', 'classify', 6),
      this.externalJob('Extract invoice fields', 'Extract vendor, amount, date, and payment terms.', 'extract', 11)
    ];
  }

  private maybeSeedExternalJob(): void {
    if (Math.random() < 0.35) {
      const templates = [
        this.externalJob('Research agent pricing', 'Find a concise pricing signal for agent labor marketplaces.', 'research', 14),
        this.externalJob('Summarize task result', 'Compress this task output for a DAO operations channel.', 'summarize', 7),
        this.externalJob('Classify lead quality', 'Score this inbound partner lead as high, medium, or low.', 'classify', 5)
      ];
      this.jobs.unshift(templates[Math.floor(Math.random() * templates.length)]);
      this.jobs = this.jobs.slice(0, 60);
    }
  }

  private externalJob(title: string, prompt: string, category: Job['category'], bounty: number): Job {
    return {
      id: uid('market_job'),
      title,
      prompt,
      category,
      bounty,
      asset: 'UCT',
      client: `@client-${Math.floor(Math.random() * 900 + 100)}`,
      status: 'open',
      createdAt: nowIso(),
      source: 'market',
      networkRef: uid('market_intent')
    };
  }

  private findBalance(asset: string): Balance {
    const balance = this.balances.find((item) => item.asset === asset);
    if (!balance) {
      throw new Error(`Missing balance for ${asset}`);
    }
    return balance;
  }
}
