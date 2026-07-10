export function runtimeStoragePaths(role: string): { dataDir: string; tokensDir: string } {
  const safeRole = role.replace(/[^a-zA-Z0-9_-]/g, '_');
  const root = `.sphere-task-data/${safeRole}`;
  return {
    dataDir: `${root}/wallet`,
    tokensDir: `${root}/tokens`
  };
}
