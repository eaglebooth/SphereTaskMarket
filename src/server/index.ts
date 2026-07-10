import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { appConfig } from './config';
import { DryRunTaskAdapter } from './adapters/dryRunTaskAdapter';
import { LiveTaskAdapter } from './adapters/liveTaskAdapter';
import { TaskMarketAgent } from './taskMarketAgent';

const app = express();
app.use(cors());
app.use(express.json());

const adapter = appConfig.mode === 'live' ? new LiveTaskAdapter() : new DryRunTaskAdapter();
const agent = new TaskMarketAgent(adapter);

const policyPatchSchema = z.object({
  maxBudget: z.number().positive().optional(),
  minQuality: z.number().min(0).max(1).optional(),
  autoApprove: z.boolean().optional(),
  tickMs: z.number().int().min(1500).max(60000).optional(),
  paymentAsset: z.string().min(1).optional(),
  maxOpenJobs: z.number().int().min(1).max(10).optional()
});

const jobCreateSchema = z.object({
  title: z.string().min(3).max(120),
  prompt: z.string().min(8).max(1000),
  category: z.enum(['summarize', 'classify', 'extract', 'research']),
  bounty: z.number().positive(),
  asset: z.string().min(1).optional(),
  client: z.string().min(1).optional()
});

const deliverySchema = z.object({
  result: z.string().min(3).max(2000),
  qualityScore: z.number().min(0).max(1).optional()
});

app.get('/api/state', (_req, res) => {
  res.json(agent.snapshot());
});

app.get('/api/reviewer', (_req, res) => {
  res.json(agent.snapshot().reviewer);
});

app.get('/api/jobs', (_req, res) => {
  res.json(agent.listJobs());
});

app.post('/api/jobs', async (req, res, next) => {
  try {
    const input = jobCreateSchema.parse(req.body);
    const job = await agent.submitExternalJob(input);
    res.status(201).json(job);
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/deliver', async (req, res, next) => {
  try {
    const input = deliverySchema.parse(req.body);
    const job = await agent.deliverExternalJob(req.params.id, input.result, input.qualityScore);
    res.json(job);
  } catch (error) {
    next(error);
  }
});

app.get('/api/payments', (_req, res) => {
  res.json(agent.listPayments());
});

app.post('/api/payments/:id/settle', async (req, res, next) => {
  try {
    const payment = await agent.settlePaymentById(req.params.id);
    res.json(payment);
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/start', (_req, res) => {
  agent.start();
  res.json(agent.snapshot());
});

app.post('/api/agent/stop', (_req, res) => {
  agent.stop();
  res.json(agent.snapshot());
});

app.post('/api/agent/tick', async (_req, res, next) => {
  try {
    await agent.tick();
    res.json(agent.snapshot());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/policy', (req, res) => {
  const patch = policyPatchSchema.parse(req.body);
  agent.updatePolicy(patch);
  res.json(agent.snapshot());
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
});

await agent.init();

app.listen(appConfig.port, '127.0.0.1', () => {
  console.log(`Sphere Task Market API listening on http://127.0.0.1:${appConfig.port}`);
});
