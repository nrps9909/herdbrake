import { readFile } from 'node:fs/promises';
import { verifyEvidence } from '../lib/evidence-verifier.ts';

const path = process.argv[2];
if (!path)
  throw new Error(
    'Usage: node --experimental-strip-types scripts/verify-evidence.ts <evidence.json>',
  );
const payload = JSON.parse(await readFile(path, 'utf8'));
const checks = await verifyEvidence(payload);
console.log(JSON.stringify(checks, null, 2));
if (Object.values(checks).some((value) => value === false))
  process.exitCode = 1;
