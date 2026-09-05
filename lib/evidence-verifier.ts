import {
  agentIntents,
  parseAgentDecisions,
  verifyAgentTrace,
} from './agent-workflow.ts';
import {
  sha256Hex,
  stableStringify,
  verifyAuditChain,
} from './assurance-core.ts';
import type { StoredRun } from './contracts.ts';
import { amountInUsd } from './herdbrake.ts';
import { parsePolicy } from './policy.ts';
import { releasePosition } from './release-plan.ts';

// This verifies internal consistency, not an external signature or the actor's identity.
export async function verifyEvidence(payload: unknown) {
  const safely = async (check: () => boolean | Promise<boolean>) => {
    try {
      return Boolean(await check());
    } catch {
      return false;
    }
  };
  const content = payload as Record<string, unknown>;
  const run = content?.run as StoredRun;
  const initial = run?.auditEvents?.[0]?.detail as Record<string, unknown>;
  const schema = await safely(
    () =>
      content.schemaVersion === '2.0' &&
      typeof run.runId === 'string' &&
      /^RUN-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        run.runId,
      ) &&
      ['scenario', 'import', 'ai'].includes(run.source) &&
      Number.isSafeInteger(run.intentCount) &&
      run.intentCount > 0 &&
      run.intentCount <= 50 &&
      run.risk.intents.length === run.intentCount &&
      new Set(run.risk.intents.map((i) => i.id)).size === run.intentCount &&
      run.risk.intents.every(
        (i) =>
          typeof i.id === 'string' &&
          i.id.length > 0 &&
          Number.isFinite(i.amount) &&
          i.amount > 0 &&
          ['USD', 'TWD', 'USDC'].includes(i.currency) &&
          ['PAY', 'DELAY', 'BUFFER', 'TRANSFER', 'USDC'].includes(i.action) &&
          ['HELD', 'RELEASED'].includes(i.status),
      ) &&
      Number.isSafeInteger(run.policyRevision) &&
      run.policyRevision >= 0 &&
      stableStringify(parsePolicy(run.policy)) === stableStringify(run.policy),
  );
  const packageHash = await safely(async () => {
    const { evidenceHash, ...data } = content;
    return (
      typeof evidenceHash === 'string' &&
      (await sha256Hex(stableStringify(data))) === evidenceHash
    );
  });
  const auditChain =
    schema &&
    (await safely(
      async () =>
        run.revision === run.auditEvents.length &&
        run.auditHead === run.auditEvents.at(-1)?.eventHash &&
        (await verifyAuditChain(run.runId, run.auditEvents)) &&
        stableStringify((content.audit as { events: unknown }).events) ===
          stableStringify(run.auditEvents),
    ));
  const originalIntentCommitments =
    schema &&
    (await safely(
      async () =>
        Object.keys(run.commitments).length === run.intentCount &&
        (
          await Promise.all(
            run.risk.intents.map(
              async (intent) =>
                (await sha256Hex(
                  stableStringify({
                    runId: run.runId,
                    ...intent,
                    status: 'HELD',
                  }),
                )) === run.commitments[intent.id],
            ),
          )
        ).every(Boolean),
    ));
  const policySnapshot =
    schema &&
    (await safely(
      () =>
        run.auditEvents[0].eventType === 'SCENARIO_RECEIVED' &&
        typeof initial.ownerId === 'string' &&
        initial.ownerId.length > 0 &&
        initial.name === run.name &&
        initial.batchSource === run.source &&
        initial.intentCount === run.intentCount &&
        initial.policyRevision === run.policyRevision &&
        initial.liquidityFloor === run.liquidityFloor &&
        run.liquidityFloor === run.policy.liquidityFloor &&
        stableStringify(initial.policy) === stableStringify(run.policy),
    ));
  const releaseState =
    schema &&
    (await safely(() => {
      const known = new Set(run.risk.intents.map((i) => i.id));
      const released = new Set<string>();
      for (const event of run.auditEvents) {
        if (event.eventType !== 'STAGED_RELEASE_AUTHORIZED') continue;
        const detail = event.detail as Record<string, unknown>;
        const ids = detail.releasedIntentIds;
        if (
          !Array.isArray(ids) ||
          ids.length < 1 ||
          ids.length > 10 ||
          detail.authorization !== 'human-confirmed' ||
          detail.authorizedBy !== initial.ownerId ||
          typeof detail.authorizationReason !== 'string' ||
          detail.authorizationReason.trim().length < 8 ||
          detail.authorizationReason.length > 160
        )
          return false;
        for (const id of ids) {
          if (typeof id !== 'string' || !known.has(id) || released.has(id))
            return false;
          released.add(id);
        }
        if (detail.remainingHeld !== known.size - released.size) return false;
      }
      return run.risk.intents.every(
        (i) => i.status === (released.has(i.id) ? 'RELEASED' : 'HELD'),
      );
    }));
  const releasePolicy =
    schema &&
    (await safely(
      () =>
        releasePosition(run.risk.intents, run.policy).withinFloor &&
        run.risk.intents.every(
          (i) =>
            i.status !== 'RELEASED' ||
            amountInUsd(i, run.policy) <= run.policy.maxIntentUsd,
        ),
    ));
  const modelRecording =
    run?.source !== 'ai' && !run?.aiTrace
      ? null
      : schema &&
        (await safely(async () => {
          const trace = run.aiTrace!;
          if (
            run.source !== 'ai' ||
            !['live', 'recorded'].includes(trace.mode) ||
            !(await verifyAgentTrace(trace)) ||
            stableStringify(initial.aiTrace) !== stableStringify(trace)
          )
            return false;
          if (
            !trace.sessions.every(
              (s) =>
                stableStringify(
                  parseAgentDecisions(JSON.parse(s.response), s.agent),
                ) === stableStringify(s.decisions),
            )
          )
            return false;
          const proposals = new Map(agentIntents(trace).map((i) => [i.id, i]));
          return (
            proposals.size === run.intentCount &&
            run.risk.intents.every(
              (i) =>
                stableStringify(proposals.get(i.id)) ===
                stableStringify({ ...i, status: 'HELD' }),
            )
          );
        }));
  const reportedChecks =
    schema &&
    (await safely(
      () =>
        (content.audit as { chainValid: unknown }).chainValid === auditChain &&
        content.commitmentsValid === originalIntentCommitments &&
        content.policyValid === policySnapshot &&
        content.releaseStateValid === releaseState &&
        content.releasePolicyValid === releasePolicy &&
        stableStringify(content.releasePosition) ===
          stableStringify(releasePosition(run.risk.intents, run.policy)),
    ));
  return {
    schema,
    packageHash,
    auditChain,
    originalIntentCommitments,
    policySnapshot,
    releaseState,
    releasePolicy,
    modelRecording,
    reportedChecks,
  };
}
