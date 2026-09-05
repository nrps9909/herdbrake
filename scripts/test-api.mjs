import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
// This runner owns its server and always tears it down. It never targets a hosted Site.
const port = 4317;
const origin = `http://localhost:${port}`;
let startup = '';
const server = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});
let failed = false;
server.on('error', () => {
  failed = true;
});
server.stdout.on('data', (data) => {
  startup = (startup + String(data)).slice(-20000);
});
server.stderr.on('data', (data) => {
  startup = (startup + String(data)).slice(-20000);
});
const stop = () => {
  if (!server.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* Already stopped. */
  }
};
process.once('SIGINT', () => {
  stop();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stop();
  process.exit(143);
});
try {
  const deadline = Date.now() + 55_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (failed || server.exitCode !== null || /already in use/i.test(startup))
      throw new Error('The dedicated local test server could not start.');
    if (startup.includes(origin)) {
      try {
        ready = (
          await fetch(`${origin}/api/health`, {
            signal: AbortSignal.timeout(2000),
          })
        ).ok;
      } catch {
        /* Worker is still starting. */
      }
      if (ready) break;
    }
    await delay(300);
  }
  if (!ready)
    throw new Error(
      'Local test server did not become healthy. Apply local migrations first.',
    );
  const tests = spawn('npm', ['run', 'test:api'], {
    stdio: 'inherit',
    env: { ...process.env, HERDBRAKE_TEST_ORIGIN: origin },
  });
  const [code] = await once(tests, 'exit');
  process.exitCode = typeof code === 'number' ? code : 1;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Integration runner failed.',
  );
  console.error(startup);
  process.exitCode = 1;
} finally {
  stop();
  await Promise.race([
    once(server, 'exit').catch(() => undefined),
    delay(3000),
  ]);
  if (server.exitCode === null && server.signalCode === null && server.pid) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      /* Already stopped. */
    }
  }
}
