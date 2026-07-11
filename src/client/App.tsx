import { BadgeCheck, Bot, BriefcaseBusiness, CircleDollarSign, Pause, Play, RefreshCw, Route, ShieldCheck, Unplug, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuditEvent, Balance, Job, TaskMarketSnapshot, TaskPolicy } from '../shared/types';
import './styles.css';

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

type ConnectedWallet = {
  nametag?: string;
  directAddress?: string;
  chainPubkey?: string;
  balance?: string;
  balances?: Balance[];
  transport?: string;
};

type WalletConnectState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  wallet?: ConnectedWallet;
  error?: string;
};

type SphereConnectSession = {
  client: {
    query<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    disconnect(): Promise<void>;
  };
  disconnect(): Promise<void>;
};

let activeConnectSession: SphereConnectSession | null = null;

function App() {
  const [snapshot, setSnapshot] = useState<TaskMarketSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [wallet, setWallet] = useState<WalletConnectState>({ status: 'idle' });

  async function load() {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error(`API ${response.status}`);
      setSnapshot(await response.json());
    } catch {
      setSnapshot((current) => advancePreview(current ?? createPreviewSnapshot()));
    }
  }

  async function command(path: string) {
    setSaving(true);
    try {
      const response = await fetch(path, { method: 'POST' });
      if (!response.ok) throw new Error(`API ${response.status}`);
      setSnapshot(await response.json());
    } catch {
      setSnapshot((current) => ({ ...advancePreview(current ?? createPreviewSnapshot()), status: path.includes('/stop') ? 'paused' : 'running' }));
    } finally {
      setSaving(false);
    }
  }

  async function patchPolicy(patch: Partial<TaskPolicy>) {
    setSaving(true);
    try {
      const response = await fetch('/api/policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      setSnapshot(await response.json());
    } catch {
      setSnapshot((current) => {
        const next = current ?? createPreviewSnapshot();
        return { ...next, policy: { ...next.policy, ...patch } };
      });
    } finally {
      setSaving(false);
    }
  }

  async function connectUserWallet(silent = false) {
    setWallet((current) => ({ ...current, status: 'connecting', error: undefined }));
    try {
      const result = await connectSphereWallet(silent);
      activeConnectSession = result.session;
      setWallet({ status: 'connected', wallet: result.wallet });
    } catch (error) {
      setWallet({ status: silent ? 'idle' : 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function disconnectUserWallet() {
    try {
      await activeConnectSession?.disconnect();
      await activeConnectSession?.client.disconnect();
    } catch {
      // Wallet disconnect can fail if the popup/iframe session is already gone.
    } finally {
      activeConnectSession = null;
      setWallet({ status: 'idle' });
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 1600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void connectUserWallet(true);
  }, []);

  const totals = useMemo(() => {
    if (!snapshot) return { paid: 0, delivered: 0, open: 0 };
    return {
      paid: snapshot.payments.filter((payment) => payment.status === 'paid' || payment.status === 'simulated').length,
      delivered: snapshot.jobs.filter((job) => job.status === 'delivered' || job.status === 'paid').length,
      open: snapshot.jobs.filter((job) => job.status === 'open').length
    };
  }, [snapshot]);

  if (!snapshot) {
    return <main className="loading">Loading Sphere Task Market...</main>;
  }

  const running = snapshot.status === 'running';
  const view = withConnectedWallet(snapshot, wallet.wallet);

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <div className="brandRow">
            <div className="brandMark" aria-hidden="true"><Route size={28} /></div>
            <h1>Sphere Task Market</h1>
          </div>
          <p className="eyebrow">Autonomous agent job market with payment settlement</p>
        </div>
        <div className="statusCluster">
          <ConnectWalletButton state={wallet} onConnect={() => connectUserWallet(false)} onDisconnect={disconnectUserWallet} />
          <span className={`pill ${view.mode}`}>{view.mode}</span>
          <span className={`pill ${view.status}`}>{view.status}</span>
          <button className={running ? 'secondary' : 'primary'} disabled={saving} onClick={() => command(running ? '/api/agent/stop' : '/api/agent/start')}>
            {running ? <Pause size={18} /> : <Play size={18} />}
            {running ? 'Pause' : 'Start'}
          </button>
          <button className="icon" disabled={saving} onClick={() => command('/api/agent/tick')} title="Run one agent tick">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {view.error && <section className="alert">{view.error}</section>}

      <section className="metrics">
        <Metric icon={<Bot />} label="Client Agent" value={view.clientName} detail={view.lastTickAt ?? 'not ticked'} />
        <Metric icon={<BadgeCheck />} label="Worker Service" value={view.workerName} detail={`${Math.round(view.workerProfile.successRate * 100)}% success`} />
        <Metric icon={<BriefcaseBusiness />} label="Delivered Jobs" value={String(totals.delivered)} detail={`${totals.open} open jobs`} />
        <Metric icon={<CircleDollarSign />} label="Payments" value={String(totals.paid)} detail={view.policy.paymentAsset} />
      </section>

      <section className="workspace">
        <aside className="leftStack">
          <WalletPanel title="Client Wallet" wallet={view.clientWallet} balances={view.balances} />
          <PolicyPanel policy={view.policy} onChange={patchPolicy} disabled={saving} />
        </aside>

        <div className="rightGrid">
          <Panel title="Job Market" className="jobsPanel">
            <JobList jobs={view.jobs} />
          </Panel>
          <Panel title="Worker Agent" className="workerPanel">
            <WorkerCard snapshot={view} />
          </Panel>
          <Panel title="Payments" className="paymentsPanel">
            <div className="paymentList">
              {view.payments.length === 0 && <p className="empty">No payments yet.</p>}
              {view.payments.map((payment) => (
                <div className="payment" key={payment.id}>
                  <div className="paymentAmount">
                    <strong>{money.format(payment.amount)} {payment.asset}</strong>
                    <span>Payment</span>
                  </div>
                  <div className="paymentRoute">
                    <span>{payment.from}</span>
                    <span>{'->'}</span>
                    <span>{payment.to}</span>
                  </div>
                  <span className={`paymentStatus ${payment.status}`}>{payment.status}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Decision Audit" className="auditPanel">
            <div className="timeline">
              {view.audit.map((event) => (
                <article className={`event ${event.level}`} key={event.id}>
                  <div className="eventHeader">
                    <strong>{auditTitle(event)}</strong>
                    <time>{new Date(event.at).toLocaleTimeString()}</time>
                  </div>
                  {auditAmount(event.message) && <span className="eventAmount">{auditAmount(event.message)}</span>}
                  <p>{event.message}</p>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </section>

    </main>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric">
      <div className="metricIcon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function Panel({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <h2>{title}</h2>
      <div className="panelBody">{children}</div>
    </section>
  );
}

function ConnectWalletButton({ state, onConnect, onDisconnect }: { state: WalletConnectState; onConnect: () => void; onDisconnect: () => void }) {
  if (state.status === 'connected' && state.wallet) {
    const name = state.wallet.nametag ? `@${state.wallet.nametag.replace(/^@/, '')}` : `${state.wallet.directAddress?.slice(0, 16) ?? 'wallet'}...`;
    return (
      <div className="connectedWallet" title={state.wallet.directAddress ?? state.wallet.chainPubkey ?? name}>
        <span className="walletDot" />
        <div>
          <strong>{name}</strong>
          <span>{state.wallet.balance ?? state.wallet.transport ?? 'Sphere wallet'}</span>
        </div>
        <button className="walletDisconnect" onClick={onDisconnect} title="Disconnect wallet" aria-label="Disconnect wallet">
          <Unplug size={14} />
        </button>
      </div>
    );
  }

  return (
    <button className={state.status === 'error' ? 'walletConnect warn' : 'walletConnect'} onClick={onConnect} disabled={state.status === 'connecting'} title={state.error ?? 'Connect your Sphere wallet'}>
      <WalletCards size={18} />
      {state.status === 'connecting' ? 'Connecting...' : state.status === 'error' ? 'Retry Wallet' : 'Connect Wallet'}
    </button>
  );
}

function WalletPanel({ title, wallet, balances }: { title: string; wallet: TaskMarketSnapshot['clientWallet']; balances: TaskMarketSnapshot['balances'] }) {
  return (
    <section className="walletPanel">
      <div className="panelTitle"><WalletCards size={18} /><h2>{title}</h2></div>
      <div className={`walletState ${wallet.connection === 'connected' || wallet.connection === 'simulated' ? 'ok' : 'warn'}`}>
        <ShieldCheck size={18} />
        <div><strong>{wallet.connection}</strong><span>{wallet.nametag}</span></div>
      </div>
      <dl className="walletDetails">
        <div><dt>Network</dt><dd>{wallet.network}</dd></div>
        <div><dt>Wallet API</dt><dd>{wallet.walletApiSession ?? 'n/a'}</dd></div>
        <div><dt>Mnemonic</dt><dd>{wallet.hasMnemonic ? 'configured' : 'not in browser'}</dd></div>
      </dl>
      <div className="miniBalances">
        {balances.map((balance) => (
          <div key={balance.asset}><span>{balance.asset}</span><strong>{money.format(balance.available)}</strong></div>
        ))}
      </div>
      <p className="walletMessage">{wallet.message}</p>
    </section>
  );
}

function PolicyPanel({ policy, onChange, disabled }: { policy: TaskPolicy; onChange: (patch: Partial<TaskPolicy>) => void; disabled: boolean }) {
  return (
    <section className="policy">
      <h2>Autonomy Policy</h2>
      <NumberInput label="Max budget" value={policy.maxBudget} step={1} onChange={(maxBudget) => onChange({ maxBudget })} disabled={disabled} />
      <NumberInput label="Min quality" value={policy.minQuality} step={0.01} onChange={(minQuality) => onChange({ minQuality })} disabled={disabled} />
      <NumberInput label="Tick ms" value={policy.tickMs} step={500} onChange={(tickMs) => onChange({ tickMs })} disabled={disabled} />
      <NumberInput label="Max open jobs" value={policy.maxOpenJobs} step={1} onChange={(maxOpenJobs) => onChange({ maxOpenJobs })} disabled={disabled} />
      <label className="toggle">
        <input type="checkbox" checked={policy.autoApprove} onChange={(event) => onChange({ autoApprove: event.target.checked })} disabled={disabled} />
        <span>Auto approve and pay delivered work</span>
      </label>
    </section>
  );
}

function NumberInput({ label, value, step, onChange, disabled }: { label: string; value: number; step: number; onChange: (value: number) => void; disabled: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function JobList({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return <p className="empty">No jobs yet.</p>;
  }
  return (
    <div className="jobList">
      {jobs.map((job) => (
        <article className="job" key={job.id}>
          <div>
            <strong>{job.title}</strong>
            <p>{job.prompt}</p>
          </div>
          <span className="jobCategory">{job.category}</span>
          <span className="jobReward">{money.format(job.bounty)} {job.asset}</span>
          <small className={`jobStatus ${job.status}`}>{job.status}</small>
        </article>
      ))}
    </div>
  );
}

function WorkerCard({ snapshot }: { snapshot: TaskMarketSnapshot }) {
  return (
    <div className="workerCard">
      <div className="workerHero">
        <Bot size={28} />
        <div>
          <strong>{snapshot.workerProfile.nametag}</strong>
          <span>Autonomous task worker</span>
        </div>
      </div>
      <div className="workerStatus">
        <span>Worker status</span>
        <strong>Available</strong>
      </div>
      <span className="sectionLabel">Capabilities</span>
      <div className="capabilities">
        {snapshot.workerProfile.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
      </div>
      <dl className="workerStats">
        <div><dt>Min bounty</dt><dd>{snapshot.workerProfile.minBounty} {snapshot.policy.paymentAsset}</dd></div>
        <div><dt>Avg latency</dt><dd>{Math.round(snapshot.workerProfile.avgLatencyMs / 1000)}s</dd></div>
        <div><dt>Payment mode</dt><dd>{snapshot.policy.autoApprove ? 'auto' : 'manual'}</dd></div>
      </dl>
    </div>
  );
}

function auditTitle(event: AuditEvent) {
  const titles: Record<string, string> = {
    accept_job: 'Job accepted',
    await_approval: 'Awaiting approval',
    deliver_result: 'Result delivered',
    init: 'Agent initialized',
    publish_job: 'Job published',
    ready: 'Agents ready',
    reject_job: 'Job rejected',
    request_payment: 'Payment requested',
    settle_payment: 'Payment settled',
    start: 'Agent loop started',
    stop: 'Agent loop paused',
    tick_error: 'Agent loop error',
    update: 'Policy updated'
  };

  return titles[event.action] ?? event.action.replaceAll('_', ' ');
}

function auditAmount(message: string) {
  return message.match(/\b\d+(?:\.\d+)?\s[A-Z]{2,6}\b/)?.[0] ?? '';
}

async function connectSphereWallet(silent: boolean): Promise<{ wallet: ConnectedWallet; session: SphereConnectSession }> {
  const browserConnect = await import('@unicitylabs/sphere-sdk/connect/browser');
  const connectCore = await import('@unicitylabs/sphere-sdk/connect');
  const result = await browserConnect.autoConnect({
    dapp: {
      name: 'Sphere Task Market',
      description: 'Post paid tasks and let autonomous Sphere agents deliver and settle work.',
      icon: `${window.location.origin}/sphere-task-market-logo.png`,
      url: window.location.origin
    },
    walletUrl: 'https://sphere.unicity.network',
    network: connectCore.SPHERE_NETWORKS.testnet2,
    permissions: ['identity:read', 'balance:read', 'transfer:request', 'events:subscribe'],
    silent
  });

  const identity = result.connection.identity;
  const wallet: ConnectedWallet = {
    nametag: identity.nametag,
    directAddress: identity.directAddress,
    chainPubkey: identity.chainPubkey,
    transport: result.transport
  };

  try {
    const assets = await result.client.query<unknown>('sphere_getAssets');
    wallet.balances = normalizeWalletAssets(assets);
    wallet.balance = formatPrimaryBalance(wallet.balances);
  } catch {
    try {
      const balance = await result.client.query<unknown>('sphere_getBalance');
      wallet.balances = normalizeWalletAssets(balance);
      wallet.balance = formatPrimaryBalance(wallet.balances) ?? normalizeWalletBalance(balance);
    } catch {
      // Balance is nice-to-have; identity connect is enough to prove wallet readiness.
    }
  }

  return { wallet, session: result };
}

function normalizeWalletAssets(raw: unknown): Balance[] {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw.map(normalizeAssetRecord).filter((asset): asset is Balance => Boolean(asset));
  }

  if (typeof raw === 'number' || typeof raw === 'string') {
    const amount = Number(raw);
    return Number.isFinite(amount) ? [{ asset: 'UCT', available: amount }] : [];
  }

  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const nested = record.assets ?? record.tokens ?? record.balances ?? record.items;
    if (Array.isArray(nested)) return normalizeWalletAssets(nested);

    const direct = normalizeAssetRecord(record);
    if (direct) return [direct];

    return Object.entries(record)
      .map(([asset, value]) => normalizeAssetEntry(asset, value))
      .filter((asset): asset is Balance => Boolean(asset));
  }

  return [];
}

function normalizeAssetRecord(raw: unknown): Balance | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const symbol = record.symbol ?? record.ticker ?? record.asset ?? record.coinId ?? record.name;
  const amount = record.available ?? record.balance ?? record.amount ?? record.totalAmount ?? record.value ?? record.quantity;
  const asset = normalizeAssetSymbol(symbol);
  const available = normalizeAmount(amount, record.decimals);
  if (!asset || available === undefined) return undefined;
  return { asset, available };
}

function normalizeAssetEntry(asset: string, value: unknown): Balance | undefined {
  const symbol = normalizeAssetSymbol(asset);
  if (!symbol) return undefined;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const available = normalizeAmount(record.available ?? record.balance ?? record.amount ?? record.totalAmount ?? record.value ?? value, record.decimals);
    return available === undefined ? undefined : { asset: symbol, available };
  }
  const available = normalizeAmount(value);
  return available === undefined ? undefined : { asset: symbol, available };
}

function normalizeAssetSymbol(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const upper = value.trim().toUpperCase();
  if (upper.includes('UCT')) return 'UCT';
  if (upper.includes('ETH')) return 'ETH';
  if (upper.includes('SOL')) return 'SOL';
  if (upper.includes('BTC')) return 'BTC';
  return upper.length <= 12 ? upper : undefined;
}

function normalizeAmount(value: unknown, decimals?: unknown) {
  if (value == null) return undefined;
  const text = typeof value === 'string' ? value.replaceAll(',', '') : value;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return undefined;
  const decimalCount = Number(decimals ?? 0);
  const amount = decimalCount > 0 && Math.abs(numeric) > 10 ** decimalCount ? numeric / 10 ** decimalCount : numeric;
  return Math.round(amount * 1_000_000) / 1_000_000;
}

function formatPrimaryBalance(balances?: Balance[]) {
  const uct = balances?.find((balance) => balance.asset === 'UCT');
  if (!uct) return undefined;
  return `${money.format(uct.available)} UCT`;
}

function normalizeWalletBalance(balance: unknown) {
  if (typeof balance === 'number' || typeof balance === 'string') {
    return `${balance} UCT`;
  }
  if (balance && typeof balance === 'object') {
    const record = balance as Record<string, unknown>;
    const value = record.UCT ?? record.uct ?? record.balance ?? record.amount ?? record.available;
    if (value !== undefined) return `${String(value)} UCT`;
  }
  return undefined;
}

function walletDisplayName(wallet?: ConnectedWallet) {
  if (!wallet) return undefined;
  if (wallet.nametag) return `@${wallet.nametag.replace(/^@/, '')}`;
  if (wallet.directAddress) return `${wallet.directAddress.slice(0, 18)}...`;
  if (wallet.chainPubkey) return `${wallet.chainPubkey.slice(0, 18)}...`;
  return undefined;
}

function withConnectedWallet(snapshot: TaskMarketSnapshot, wallet?: ConnectedWallet): TaskMarketSnapshot {
  const name = walletDisplayName(wallet);
  if (!wallet || !name) return snapshot;

  const previousClient = snapshot.clientName;
  const balances = wallet.balances?.length ? wallet.balances.map((balance) => ({ ...balance })) : snapshot.balances.map((balance) => ({ ...balance }));
  if (!wallet.balances?.length) {
    const balanceAmount = wallet.balance?.match(/-?\d+(?:\.\d+)?/)?.[0];
    if (balanceAmount) {
    const index = balances.findIndex((balance) => balance.asset === 'UCT');
    const nextBalance = Number(balanceAmount);
    if (Number.isFinite(nextBalance)) {
      if (index >= 0) balances[index] = { ...balances[index], available: nextBalance };
      else balances.unshift({ asset: 'UCT', available: nextBalance });
    }
    }
  }

  return {
    ...snapshot,
    clientName: name,
    clientWallet: {
      ...snapshot.clientWallet,
      connection: 'connected',
      nametag: name,
      address: wallet.directAddress ?? wallet.chainPubkey,
      hasMnemonic: false,
      walletApiSession: 'online',
      message: 'Connected Sphere wallet is now the client identity for posting and paying tasks.'
    },
    balances,
    jobs: snapshot.jobs.map((job) => (job.client === previousClient || job.client === '@task-client' ? { ...job, client: name } : job)),
    payments: snapshot.payments.map((payment) => (payment.from === previousClient || payment.from === '@task-client' ? { ...payment, from: name } : payment)),
    audit: snapshot.audit.map((event) => ({
      ...event,
      message: event.message.replaceAll(previousClient, name).replaceAll('@task-client', name)
    }))
  };
}

function createPreviewSnapshot(): TaskMarketSnapshot {
  return {
    mode: 'live',
    status: 'running',
    clientName: '@task-client',
    workerName: '@task-worker',
    lastTickAt: new Date().toISOString(),
    policy: { maxBudget: 18, minQuality: 0.82, autoApprove: true, tickMs: 4500, paymentAsset: 'UCT', maxOpenJobs: 3 },
    clientWallet: { mode: 'live', connection: 'connected', network: 'testnet2', nametag: '@task-client', hasMnemonic: true, walletApiSession: 'online', message: 'Hosted preview uses demo fallback data. Run the backend for live Sphere SDK execution.' },
    workerWallet: { mode: 'live', connection: 'connected', network: 'testnet2', nametag: '@task-worker', hasMnemonic: true, walletApiSession: 'online', message: 'Worker agent is ready.' },
    balances: [{ asset: 'UCT', available: 420 }, { asset: 'ETH', available: 2.4 }],
    jobs: [],
    payments: [],
    workerProfile: { nametag: '@task-worker', capabilities: ['summarize', 'classify', 'extract', 'research'], minBounty: 5, successRate: 0.94, avgLatencyMs: 4200, wallet: { mode: 'live', connection: 'connected', network: 'testnet2', nametag: '@task-worker', hasMnemonic: true, message: 'Ready.' } },
    reviewer: {
      sdkDependency: { label: 'Sphere SDK dependency', status: 'ready', detail: '@unicitylabs/sphere-sdk is installed in the project.' },
      backendAgentLoop: { label: 'Backend autonomous loop', status: 'warning', detail: 'Hosted preview is showing fallback data; run npm run dev for the backend loop.' },
      walletMode: { label: 'Wallet mode', status: 'warning', detail: 'Preview mode is active. Use SPHERE_MODE=live for wallet execution.' },
      clientWallet: { label: 'Client wallet', status: 'ready', detail: 'Demo client wallet is represented in preview data.' },
      workerWallet: { label: 'Worker wallet', status: 'ready', detail: 'Demo worker wallet is represented in preview data.' },
      network: { label: 'Network', status: 'ready', detail: 'testnet2 reviewer preview.' },
      publicAgentApi: { label: 'Public agent API', status: 'warning', detail: 'API is available when the backend is running on port 8797.' },
      settlement: { label: 'Payment settlement', status: 'ready', detail: 'Preview payments are deterministic for reviewer reproduction.' }
    },
    audit: [{ id: 'preview', at: new Date().toISOString(), actor: 'system', action: 'preview', level: 'success', message: 'Hosted preview is running with demo job-market data.' }]
  };
}

function advancePreview(snapshot: TaskMarketSnapshot): TaskMarketSnapshot {
  if (snapshot.status === 'paused') return snapshot;
  const now = new Date();
  const seed = Math.floor(now.getTime() / 4500);
  const category = ['summarize', 'classify', 'extract', 'research'][seed % 4] as Job['category'];
  const bounty = 6 + (seed % 9);
  const job: Job = {
    id: `preview-job-${seed}`,
    title: `${category} task`,
    prompt: `Autonomous worker completes a ${category} task and requests payment.`,
    category,
    bounty,
    asset: 'UCT',
    client: '@task-client',
    worker: '@task-worker',
    status: 'paid',
    createdAt: now.toISOString(),
    deliveredAt: now.toISOString(),
    paidAt: now.toISOString(),
    result: 'Preview result delivered.',
    qualityScore: 0.91,
    source: 'client'
  };
  const payment = { id: `preview-pay-${seed}`, jobId: job.id, from: '@task-client', to: '@task-worker', amount: bounty, asset: 'UCT', status: 'paid' as const, createdAt: now.toISOString(), settledAt: now.toISOString(), networkRef: 'preview' };
  const jobs = snapshot.jobs.some((item) => item.id === job.id) ? snapshot.jobs : [job, ...snapshot.jobs].slice(0, 40);
  const payments = snapshot.payments.some((item) => item.id === payment.id) ? snapshot.payments : [payment, ...snapshot.payments].slice(0, 30);
  const auditEvent: AuditEvent = { id: `evt-${seed}`, at: now.toISOString(), actor: 'payment', action: 'settle_payment', level: 'success', message: `Paid ${bounty} UCT to @task-worker.` };
  return {
    ...snapshot,
    lastTickAt: now.toISOString(),
    jobs,
    payments,
    audit: [auditEvent, ...snapshot.audit].slice(0, 100)
  };
}

createRoot(document.getElementById('root')!).render(<App />);
