# Reviewer Walkthrough

This walkthrough is designed to prove that Sphere Task Market is a coded app with a backend autonomous agent loop and Sphere SDK boundary.

## 60 Second Demo

1. Install and start the app:

```bash
npm install
npm run dev
```

2. Open the dashboard:

```text
http://127.0.0.1:5174
```

3. Click **Start** if the loop is not already running.

4. Watch the lifecycle:

- Client agent publishes a paid task.
- Worker agent evaluates capability and bounty.
- Worker accepts the job.
- Worker delivers a result with quality score.
- Client agent requests payment.
- Payment is settled in dry-run mode or attempted in live SDK mode.
- Decision Audit records every autonomous action.

5. Inspect the integration panel:

- SDK dependency.
- Backend loop.
- Wallet mode.
- Client wallet.
- Worker wallet.
- Public agent API.
- Settlement readiness.

## API Demo

List jobs:

```bash
curl http://127.0.0.1:8797/api/jobs
```

Create a job from an external agent:

```bash
curl -X POST http://127.0.0.1:8797/api/jobs \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Research market signal\",\"prompt\":\"Produce a concise signal for agent labor pricing.\",\"category\":\"research\",\"bounty\":14,\"client\":\"@external-agent\"}"
```

Run one autonomous tick:

```bash
curl -X POST http://127.0.0.1:8797/api/agent/tick
```

Check reviewer integration status:

```bash
curl http://127.0.0.1:8797/api/reviewer
```

## Live Mode

Dry-run mode is for deterministic review. To test real Sphere SDK / Unicity Wallet wiring:

1. Copy `.env.example` to `.env`.
2. Set `SPHERE_MODE=live`.
3. Add testnet nametags and mnemonics for `SPHERE_CLIENT_MNEMONIC` and `SPHERE_WORKER_MNEMONIC`.
4. Run `npm run dev`.

Live mode initializes the Sphere SDK adapter in `src/server/adapters/liveTaskAdapter.ts`, publishes job intents, discovers compatible jobs, and attempts settlement through available payment primitives.
