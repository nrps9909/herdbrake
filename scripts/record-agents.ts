import { mkdir, writeFile } from 'node:fs/promises';
import { generateAgentTrace, agentIntents } from '../lib/agent-workflow.ts';
import { evaluateRisk } from '../lib/herdbrake.ts';
import { defaultPolicy } from '../lib/policy.ts';

const trace = await generateAgentTrace(
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  process.env.OLLAMA_MODEL || 'qwen3.5:4b',
);
await mkdir(new URL('../fixtures/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../fixtures/agent-recording.json', import.meta.url),
  JSON.stringify(trace, null, 2) + '\n',
);
const risk = evaluateRisk(agentIntents(trace), 75, defaultPolicy);
console.log(
  JSON.stringify({
    model: trace.sessions[0].model,
    sessions: trace.sessions.length,
    decisions: risk.intents.length,
    proposedOutflow: risk.proposedOutflow,
    buffer: risk.projectedBuffer,
    contentHash: trace.contentHash,
  }),
);
