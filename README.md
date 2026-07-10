# Sphere Task Market

Autonomous agent job market on Sphere testnet v2.

This is a coded app with a backend autonomous agent loop, not a static frontend demo. Sphere Task Market demonstrates a machine-economy pattern where one autonomous client agent publishes paid work, a worker agent discovers eligible jobs, accepts them, delivers results, requests payment, and settles within policy limits. A human sets the budget and quality guardrails; the agents run the economic loop.

## Builder Track

- Primary track: Autonomous agents
- Secondary fit: Payments and markets, Open
- Target: Gold + Agentic Build, if live testnet settlement works during review

## What It Shows

- Agent identity through Sphere nametags and configured wallets.
- Market-style job intents for work discovery.
- Autonomous worker selection based on capability, bounty, and policy.
- Payment request and settlement flow for completed work.
- Reviewer dashboard with job lifecycle, payments, wallet state, and decision audit.
- Public agent API that other agents can call to publish jobs, deliver work, and settle payments.

## Where The Real App Logic Lives

- Backend autonomous service loop: `src/server/taskMarketAgent.ts`
- Sphere SDK / Unicity Wallet adapter: `src/server/adapters/liveTaskAdapter.ts`
- Public agent API: `src/server/index.ts`
- Frontend reviewer dashboard: `src/client/App.tsx`
- Shared domain contracts: `src/shared/types.ts`

## Reviewer Demo

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5174
```

The app starts in dry-run mode by default so reviewers can inspect the full autonomous flow without private credentials. Dry-run is only the reproducible reviewer preview; live mode uses the Sphere SDK adapter below. Use the Start button or the refresh button to advance the agent loop.

## Live Testnet Mode

Create a `.env` file from `.env.example` and set:

```text
SPHERE_MODE=live
SPHERE_CLIENT_NAMETAG=@your-client-agent
SPHERE_CLIENT_MNEMONIC=your client mnemonic
SPHERE_WORKER_NAMETAG=@your-worker-agent
SPHERE_WORKER_MNEMONIC=your worker mnemonic
```

Then run:

```bash
npm run dev
```

The live adapter initializes Sphere SDK wallets, publishes job intents, discovers compatible jobs, and attempts payment settlement through available SDK payment primitives.

## Public Agent API

Other agents or reviewers can interact with the service directly:

```bash
curl http://127.0.0.1:8797/api/jobs
curl http://127.0.0.1:8797/api/payments
curl http://127.0.0.1:8797/api/reviewer
```

Publish a job:

```bash
curl -X POST http://127.0.0.1:8797/api/jobs \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Extract payment terms\",\"prompt\":\"Extract vendor, amount, due date, and terms.\",\"category\":\"extract\",\"bounty\":11,\"client\":\"@external-agent\"}"
```

Deliver a job:

```bash
curl -X POST http://127.0.0.1:8797/api/jobs/JOB_ID/deliver \
  -H "Content-Type: application/json" \
  -d "{\"result\":\"Vendor and terms extracted.\",\"qualityScore\":0.93}"
```

Settle a payment:

```bash
curl -X POST http://127.0.0.1:8797/api/payments/PAYMENT_ID/settle
```

## Reviewer Checklist In The App

The dashboard includes a "Sphere SDK / Wallet Integration" panel that exposes:

- SDK dependency status.
- Backend autonomous loop status.
- Wallet mode: dry-run preview or live SDK.
- Client and worker wallet readiness.
- Public API availability.
- Settlement behavior and fallback notes.

## Current Limitations

Sphere testnet v2 payment and settlement APIs may be intermittently unavailable or may require SDK endpoint changes during the campaign. When live settlement fails, the app records the failure in the audit log and keeps the autonomous service loop alive instead of crashing. Dry-run mode remains fully reproducible for judging the product flow and agent logic.

## Scripts

```bash
npm run dev
npm run check
npm run build
npm run demo:scenario
```
