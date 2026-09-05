import { readFile } from 'node:fs/promises';
import {
  sha256Hex,
  stableStringify,
  verifyAuditChain,
} from '../lib/assurance-core.ts';
import { verifyAgentTrace } from '../lib/agent-workflow.ts';
import type { StoredRun } from '../lib/contracts.ts';

const path = process.argv[2];
if (!path)
  throw new Error(
    'Usage: node --experimental-strip-types scripts/verify-evidence.ts <evidence.json>',
  );
const payload = JSON.parse(await readFile(path, 'utf8'));
const { evidenceHash, ...content } = payload;
const run = content.run as StoredRun;
const checks = {
  packageHash:
    typeof evidenceHash === 'string' &&
    (await sha256Hex(stableStringify(content))) === evidenceHash,
  auditChain: await verifyAuditChain(run.runId, run.auditEvents),
  originalIntentCommitments: (
    await Promise.all(
      run.risk.intents.map(
        async (intent) =>
          (await sha256Hex(
            stableStringify({ runId: run.runId, ...intent, status: 'HELD' }),
          )) === run.commitments[intent.id],
      ),
    )
  ).every(Boolean),
  modelRecording: run.aiTrace ? await verifyAgentTrace(run.aiTrace) : null,
};
console.log(JSON.stringify(checks, null, 2));
if (
  !checks.packageHash ||
  !checks.auditChain ||
  !checks.originalIntentCommitments ||
  checks.modelRecording === false
)
  process.exitCode = 1;
