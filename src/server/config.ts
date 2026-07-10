import 'dotenv/config';
import { z } from 'zod';
import type { TaskPolicy } from '../shared/types';

const envSchema = z.object({
  SPHERE_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
  SPHERE_NETWORK: z.enum(['testnet', 'testnet2', 'mainnet', 'dev']).default('testnet2'),
  SPHERE_WALLET_API_URL: z.string().url().default('https://wallet-api.unicity.network'),
  SPHERE_ORACLE_API_KEY: z.string().optional(),
  SPHERE_DEVICE_ID: z.string().default('sphere-task-market-local'),
  SPHERE_ALLOW_MNEMONIC_NON_TTY: z.string().default('1'),
  SPHERE_CLIENT_NAMETAG: z.string().default('@task-client'),
  SPHERE_CLIENT_MNEMONIC: z.string().optional(),
  SPHERE_WORKER_NAMETAG: z.string().default('@task-worker'),
  SPHERE_WORKER_MNEMONIC: z.string().optional(),
  SPHERE_PAYMENT_ASSET: z.string().default('UCT'),
  PORT: z.coerce.number().default(8797)
});

export const env = envSchema.parse(process.env);

export const defaultPolicy: TaskPolicy = {
  maxBudget: 18,
  minQuality: 0.82,
  autoApprove: true,
  tickMs: 4500,
  paymentAsset: env.SPHERE_PAYMENT_ASSET,
  maxOpenJobs: 3
};

export const appConfig = {
  mode: env.SPHERE_MODE,
  port: env.PORT,
  clientName: env.SPHERE_CLIENT_NAMETAG,
  workerName: env.SPHERE_WORKER_NAMETAG
};
