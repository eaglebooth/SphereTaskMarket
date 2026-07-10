import type { Balance, Job, PaymentRecord, TaskMarketAdapter, WalletStatus } from '../../shared/types';
import { appConfig, env } from '../config';
import { RuntimeJsonStorageProvider } from '../runtimeJsonStorageProvider';
import { runtimeStoragePaths } from '../storagePaths';
import { nowIso, round, uid } from '../utils';

type AnyRecord = Record<string, any>;

export class LiveTaskAdapter implements TaskMarketAdapter {
  mode = 'live' as const;
  private clientSphere?: AnyRecord;
  private workerSphere?: AnyRecord;

  async init(): Promise<void> {
    this.clientSphere = await this.initSphere('client', env.SPHERE_CLIENT_NAMETAG, env.SPHERE_CLIENT_MNEMONIC);
    this.workerSphere = await this.initSphere('worker', env.SPHERE_WORKER_NAMETAG, env.SPHERE_WORKER_MNEMONIC);
  }

  async getBalances(): Promise<Balance[]> {
    const sphere = this.requireClientSphere();
    const assets = await sphere.payments.getAssets();
    if (Array.isArray(assets)) {
      return assets.map((asset: AnyRecord) => ({
        asset: String(asset.symbol ?? asset.coinId ?? asset.asset ?? 'UNKNOWN'),
        available: this.normalizeAssetAmount(asset)
      }));
    }
    return Object.entries(assets ?? {}).map(([asset, amount]) => ({
      asset,
      available: Number(amount)
    }));
  }

  getClientWallet(): WalletStatus {
    return this.walletStatus(this.clientSphere, env.SPHERE_CLIENT_NAMETAG, Boolean(env.SPHERE_CLIENT_MNEMONIC));
  }

  getWorkerWallet(): WalletStatus {
    return this.walletStatus(this.workerSphere, env.SPHERE_WORKER_NAMETAG, Boolean(env.SPHERE_WORKER_MNEMONIC));
  }

  async publishJob(job: Omit<Job, 'id' | 'status' | 'createdAt' | 'source'>): Promise<Job> {
    const market = this.requireClientSphere().market;
    const payload = {
      description: [
        'sphere-task-market job',
        `title=${job.title}`,
        `category=${job.category}`,
        `bounty=${job.bounty}`,
        `asset=${job.asset}`,
        `client=${job.client}`,
        `prompt=${job.prompt}`
      ].join(' | '),
      intentType: 'job_request',
      category: 'sphere-task-market',
      price: job.bounty,
      currency: job.asset,
      contactHandle: job.client,
      expiresInDays: 1
    };
    const raw = await market.postIntent(payload);
    return {
      ...job,
      id: String(raw?.intentId ?? raw?.id ?? uid('live_job')),
      status: 'open',
      createdAt: nowIso(),
      source: 'client',
      networkRef: String(raw?.intentId ?? raw?.id ?? '')
    };
  }

  async discoverJobs(): Promise<Job[]> {
    const market = this.requireWorkerSphere().market;
    const raw = await market.search('sphere-task-market job bounty agent task', {
      filters: { category: 'sphere-task-market' },
      limit: 50
    });
    const items = Array.isArray(raw) ? raw : raw?.items ?? raw?.intents ?? [];
    return items.map((item: AnyRecord) => this.normalizeJob(item)).filter(Boolean).slice(0, 40);
  }

  async acceptJob(job: Job, worker: string): Promise<Job> {
    return {
      ...job,
      worker,
      status: 'assigned',
      assignedAt: nowIso()
    };
  }

  async deliverJob(job: Job, result: string, qualityScore: number): Promise<Job> {
    return {
      ...job,
      result,
      qualityScore,
      status: 'delivered',
      deliveredAt: nowIso()
    };
  }

  async requestPayment(job: Job): Promise<PaymentRecord> {
    const payment: PaymentRecord = {
      id: uid('live_payreq'),
      jobId: job.id,
      from: job.client,
      to: job.worker ?? env.SPHERE_WORKER_NAMETAG,
      amount: job.bounty,
      asset: job.asset,
      status: 'requested',
      createdAt: nowIso(),
      networkRef: job.networkRef
    };
    return payment;
  }

  async settlePayment(payment: PaymentRecord): Promise<PaymentRecord> {
    const payments = this.requireClientSphere().payments;
    const target = payment.to;

    try {
      if (typeof payments.sendPayment === 'function') {
        const raw = await payments.sendPayment({
          recipient: target,
          amount: payment.amount,
          currency: payment.asset
        });
        return {
          ...payment,
          status: 'paid',
          settledAt: nowIso(),
          networkRef: String(raw?.txId ?? raw?.id ?? payment.networkRef ?? '')
        };
      }
    } catch (error) {
      return {
        ...payment,
        status: 'failed',
        networkRef: error instanceof Error ? error.message : String(error)
      };
    }

    return {
      ...payment,
      status: 'requested',
      networkRef: payment.networkRef ?? 'payment-method-not-available'
    };
  }

  private async initSphere(role: string, nametag: string, mnemonic?: string): Promise<AnyRecord> {
    const sdk = await import('@unicitylabs/sphere-sdk');
    const nodeImpl = await import('@unicitylabs/sphere-sdk/impl/nodejs');
    const walletApi = await import('@unicitylabs/sphere-sdk/impl/shared/wallet-api');
    const storage = runtimeStoragePaths(role);
    const base = nodeImpl.createNodeProviders({
      network: env.SPHERE_NETWORK,
      dataDir: storage.dataDir,
      tokensDir: storage.tokensDir,
      oracle: { apiKey: env.SPHERE_ORACLE_API_KEY },
      market: true
    });
    base.storage = new RuntimeJsonStorageProvider(storage.dataDir) as unknown as typeof base.storage;
    const providers = walletApi.createWalletApiProviders(base, {
      baseUrl: env.SPHERE_WALLET_API_URL,
      network: 'testnet2',
      deviceId: `${env.SPHERE_DEVICE_ID}-${role}`
    });
    const initArgs = {
      ...providers,
      network: env.SPHERE_NETWORK,
      autoGenerate: !mnemonic,
      nametag,
      market: true,
      accounting: true,
      payments: true
    };
    if (mnemonic) {
      Object.assign(initArgs, { mnemonic });
    }
    const result = await sdk.Sphere.init(initArgs as Parameters<typeof sdk.Sphere.init>[0]);
    return result.sphere;
  }

  private walletStatus(sphere: AnyRecord | undefined, nametag: string, hasMnemonic: boolean): WalletStatus {
    const identity = sphere?.identity;
    const address = identity?.directAddress ?? identity?.address;
    return {
      mode: 'live',
      connection: sphere?.isReady ? 'connected' : hasMnemonic ? 'configured' : 'missing',
      network: env.SPHERE_NETWORK,
      nametag,
      address: address ? String(address) : undefined,
      hasMnemonic,
      walletApiSession: sphere?.walletApiSessionStatus ?? null,
      message: sphere?.isReady
        ? 'Live agent wallet is loaded and ready for autonomous job-market actions.'
        : 'Live mode needs a testnet mnemonic in .env for this agent.'
    };
  }

  private normalizeJob(item: AnyRecord): Job {
    const parsed = this.parseDescription(String(item.description ?? ''));
    const bounty = Number(parsed.bounty ?? item.price ?? 0);
    return {
      id: String(item.id ?? item.intentId ?? uid('remote_job')),
      title: String(parsed.title ?? item.title ?? 'Untitled agent task'),
      prompt: String(parsed.prompt ?? item.description ?? ''),
      category: this.normalizeCategory(parsed.category),
      bounty: round(Number.isFinite(bounty) ? bounty : 0),
      asset: String(parsed.asset ?? item.currency ?? env.SPHERE_PAYMENT_ASSET),
      client: String(parsed.client ?? item.owner ?? item.contactHandle ?? '@unknown-client'),
      status: 'open',
      createdAt: String(item.createdAt ?? nowIso()),
      source: 'market',
      networkRef: String(item.id ?? item.intentId ?? '')
    };
  }

  private normalizeCategory(category: unknown): Job['category'] {
    return ['summarize', 'classify', 'extract', 'research'].includes(String(category))
      ? (String(category) as Job['category'])
      : 'summarize';
  }

  private parseDescription(description: string): Record<string, string> {
    return Object.fromEntries(
      description
        .split('|')
        .map((part) => part.trim().split('='))
        .filter((parts): parts is [string, string] => parts.length === 2)
        .map(([key, value]) => [key.trim(), value.trim()])
    );
  }

  private normalizeAssetAmount(asset: AnyRecord): number {
    const raw = asset.totalAmount ?? asset.amount ?? asset.balance ?? asset.available ?? 0;
    const decimals = Number(asset.decimals ?? 0);
    const value = Number(raw);
    return decimals > 0 ? round(value / 10 ** decimals, 6) : value;
  }

  private requireClientSphere(): AnyRecord {
    if (!this.clientSphere) {
      throw new Error('Client Sphere SDK is not initialized.');
    }
    return this.clientSphere;
  }

  private requireWorkerSphere(): AnyRecord {
    if (!this.workerSphere) {
      throw new Error('Worker Sphere SDK is not initialized.');
    }
    return this.workerSphere;
  }
}
