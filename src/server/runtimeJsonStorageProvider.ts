import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class RuntimeJsonStorageProvider {
  readonly id = 'sphere-task-json-storage';

  constructor(private readonly rootDir: string) {}

  async get(key: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.pathFor(key), 'utf8'));
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  }

  async delete(key: string): Promise<void> {
    await this.set(key, undefined);
  }

  private pathFor(key: string): string {
    return join(this.rootDir, `${key.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`);
  }
}
