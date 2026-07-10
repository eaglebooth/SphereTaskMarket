const apiBase = process.env.SPHERE_TASK_API_URL ?? 'http://127.0.0.1:8797';

async function post(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function get(path: string): Promise<any> {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

await post('/api/agent/start');
for (let index = 0; index < 5; index += 1) {
  await post('/api/agent/tick');
}
const state = await get('/api/state');
console.log(
  JSON.stringify(
    {
      status: state.status,
      jobs: state.jobs.length,
      payments: state.payments.length,
      latestJob: state.jobs[0],
      latestPayment: state.payments[0]
    },
    null,
    2
  )
);

export {};
