import { writeFile } from 'node:fs/promises';
import { runRiskEngine, scenarios } from '../lib/herdbrake.ts';
import { defaultPolicy } from '../lib/policy.ts';
import { planRelease, releasePosition } from '../lib/release-plan.ts';

const cases = scenarios.flatMap((scenario) =>
  Array.from({ length: 10 }, (_, index) => {
    const severity = (index + 1) / 10;
    const result = runRiskEngine({ scenarioId: scenario.id, severity });
    let intents = result.intents;
    let approvals = 0;
    for (let i = 0; i < result.intents.length; i++) {
      const plan = planRelease(intents, 1, true, defaultPolicy);
      if (!plan.allowed) break;
      intents = intents.map((intent) =>
        plan.ids.includes(intent.id)
          ? { ...intent, status: 'RELEASED' as const }
          : intent,
      );
      approvals++;
    }
    const position = releasePosition(intents, defaultPolicy);
    return {
      scenarioId: scenario.id,
      severity,
      state: result.state,
      originalBuffer: result.projectedBuffer,
      guardedBuffer: position.retainedBuffer,
      approvedCount: approvals,
      heldCount: intents.length - approvals,
      guardPassed: position.withinFloor,
    };
  }),
);
const report = {
  method:
    'Deterministic synthetic engine; six scenarios × ten severity levels; sequential one-intent approvals in priority order until the next approval is refused.',
  limits:
    'Not an LLM evaluation, prediction accuracy, customer outcome or causal evidence of herding. The guard is batch-scoped and uses fixed policy exchange rates. It does not optimize a global payment schedule.',
  policy: defaultPolicy,
  summary: {
    cases: cases.length,
    intents: cases.length * 30,
    originalFloorBreaches: cases.filter(
      (item) => item.originalBuffer < defaultPolicy.liquidityFloor,
    ).length,
    guardedFloorBreaches: cases.filter((item) => !item.guardPassed).length,
  },
  cases,
};
await writeFile(
  new URL('../docs/acceptance/synthetic-benchmark.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report.summary));
if (report.summary.guardedFloorBreaches) process.exitCode = 1;
