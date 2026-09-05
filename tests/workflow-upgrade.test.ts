import assert from 'node:assert/strict';
import test from 'node:test';
import { agentCsvTemplate, parseAgentCsv } from '../lib/agent-input.ts';
import {
  generateAgentTrace,
  agentIntents,
  verifyAgentTrace,
  traceHash,
} from '../lib/agent-workflow.ts';
import { defaultPolicy } from '../lib/policy.ts';
import { csvTemplate } from '../lib/import-csv.ts';
import { parseReleaseInput, parseRunInput } from '../lib/contracts.ts';
import { planRelease, suggestRelease } from '../lib/release-plan.ts';
import { verifyEvidence } from '../lib/evidence-verifier.ts';
import { createAssuranceRepository } from '../lib/server/assurance-repository.ts';
import { createWorkspaceRepository } from '../lib/server/workspace-repository.ts';
import { testDatabase } from './helpers/database.ts';
import { ApiError } from '../lib/errors.ts';
import { mutationRecovery } from '../lib/mutation-recovery.ts';

const approval = {
  confirmed: true as const,
  prioritizeCritical: false,
  authorizationReason: '已核對本期必要支出與付款目的地',
  idempotencyKey: 'workflow:release',
};

void test('uncertain creation recovers after reload without storing invoice data and is scoped to each owner', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const payload = { csv: 'private invoice content', policyRevision: 0 };
  const original = await mutationRecovery('alice', storage).requestId(
    'import',
    payload,
  );
  assert.ok(![...values.values()].join().includes(payload.csv));
  const restored = mutationRecovery('alice', storage);
  assert.equal(await restored.requestId('import', payload), original);
  assert.notEqual(
    await mutationRecovery('bob', storage).requestId('import', payload),
    original,
  );
  restored.complete('import');
  assert.notEqual(await restored.requestId('import', payload), original);
  const withoutStorage = mutationRecovery('alice', {
    getItem: () => {
      throw new Error('disabled');
    },
    setItem: () => {
      throw new Error('disabled');
    },
    removeItem: () => {
      throw new Error('disabled');
    },
  });
  const fallback = await withoutStorage.requestId('ai', payload);
  assert.equal(await withoutStorage.requestId('ai', payload), fallback);
  assert.doesNotThrow(() => withoutStorage.complete('ai'));
});

void test('identical concurrent CSV retries save one run; changed data and foreign owners cannot reuse its request', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const repo = createAssuranceRepository(database, 'alice');
    const input = {
      name: '同一匯入',
      csv: csvTemplate,
      policyRevision: 0,
      requestId: crypto.randomUUID(),
    };
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => repo.importRun(input)),
    );
    for (const run of runs) assert.deepEqual(run, runs[0]);
    assert.equal((await repo.listRuns()).total, 1);
    await assert.rejects(
      repo.importRun({
        ...input,
        csv: csvTemplate.replace('125000', '125001'),
      }),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    assert.equal(
      await createAssuranceRepository(database, 'bob').getStoredRun(
        runs[0].runId,
      ),
      null,
    );
    const workspace = createWorkspaceRepository(database, 'alice');
    await workspace.updateSettings({
      ...(await workspace.getSettings()),
      name: '新政策名稱',
    });
    assert.deepEqual(
      await repo.importRun(input),
      runs[0],
      'a committed retry must survive a later policy update',
    );
    await assert.rejects(
      repo.importRun({ ...input, requestId: crypto.randomUUID() }),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
  } finally {
    sqlite.close();
  }
});

void test('scenario creation transports identity, binds payload and fails stale policies before writing', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const repo = createAssuranceRepository(database, 'alice');
    const input = parseRunInput({
      scenarioId: 'fx',
      severity: 0.5,
      liquidityFloor: 75,
      requestId: crypto.randomUUID(),
      policyRevision: 0,
    });
    const [one, two] = await Promise.all([
      repo.createStressRun(input),
      repo.createStressRun(input),
    ]);
    assert.deepEqual(one, two);
    assert.deepEqual(await repo.getStoredRun(one.runId), one);
    await assert.rejects(
      repo.createStressRun({ ...input, severity: 1 }),
      ApiError,
    );
    await assert.rejects(
      repo.createStressRun({
        ...input,
        requestId: crypto.randomUUID(),
        policyRevision: 1,
      }),
      ApiError,
    );
    assert.equal((await repo.listRuns()).total, 1);
    for (const bad of [
      { requestId: 1 },
      { requestId: '' },
      { policyRevision: '0' },
      { policyRevision: -1 },
    ])
      assert.throws(() => parseRunInput({ ...input, ...bad }), ApiError);
  } finally {
    sqlite.close();
  }
});

void test('explicit authorization releases only selected IDs and rejects stale, unknown, duplicate or changed selections', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const repo = createAssuranceRepository(database, 'alice');
    const run = await repo.importRun({
      name: '逐筆核准',
      csv: csvTemplate,
      policyRevision: 0,
    });
    const ids = [run.risk.intents[2].id, run.risk.intents[0].id];
    const input = {
      ...approval,
      count: 2,
      intentIds: ids,
      expectedAuditHead: run.auditHead!,
    };
    for (const change of [
      { intentIds: [ids[0], ids[0]] },
      { count: 1 },
      { expectedAuditHead: undefined },
      { intentIds: [] },
    ])
      assert.throws(() => parseReleaseInput({ ...input, ...change }), ApiError);
    await assert.rejects(
      repo.releaseIntents(run.runId, {
        ...input,
        intentIds: [ids[0], 'UNKNOWN'],
      }),
      ApiError,
    );
    assert.deepEqual(await repo.getStoredRun(run.runId), run);
    const first = await repo.releaseIntents(run.runId, input);
    assert.deepEqual(first.releasedIntentIds, ids);
    const restored = (await repo.getStoredRun(run.runId))!;
    assert.equal(
      planRelease(restored.risk.intents, 2, false, restored.policy, ids)
        .allowed,
      false,
      'the visible review must safely disable after a committed state refresh',
    );
    assert.equal(restored.risk.intents[1].status, 'HELD');
    assert.equal(
      (await repo.releaseIntents(run.runId, input)).idempotentReplay,
      true,
    );
    await assert.rejects(
      repo.releaseIntents(run.runId, {
        ...input,
        intentIds: [...ids].reverse(),
      }),
      ApiError,
    );
    await assert.rejects(
      repo.releaseIntents(run.runId, {
        ...input,
        idempotencyKey: 'workflow:new',
        expectedAuditHead: restored.auditHead!,
      }),
      ApiError,
    );
    assert.ok(
      Object.values(
        await verifyEvidence(await repo.getEvidence(run.runId)),
      ).every((v) => v !== false),
    );
  } finally {
    sqlite.close();
  }
});

void test('custom invoice parser validates IDs, sizes, row amounts and complete department limits', () => {
  const input = parseAgentCsv(agentCsvTemplate, defaultPolicy, 1_000_000);
  assert.equal(input.invoices.length, 6);
  assert.equal(new Set(input.invoices.map((i) => i.entity)).size, 3);
  for (const csv of [
    agentCsvTemplate.replace('INV-TPE-02', 'INV-TPE-01'),
    agentCsvTemplate.replace('600000', '-1'),
    agentCsvTemplate.replace('600000', '0.001'),
    agentCsvTemplate.replace('600000', '1000001'),
    agentCsvTemplate.replace('critical,description', 'critical,unexpected'),
    agentCsvTemplate.replace('INV-HSC-01,新竹研發', 'INV-HSC-01,第四部門'),
  ])
    assert.throws(() => parseAgentCsv(csv, defaultPolicy, 1_000_000), ApiError);
  for (const budget of [0, 0.001, 1.001, NaN, Infinity, -1, '1000'])
    assert.throws(
      () => parseAgentCsv(agentCsvTemplate, defaultPolicy, budget as number),
      ApiError,
    );
  const header = agentCsvTemplate.split('\n')[0];
  const tooMany =
    header +
    '\n' +
    Array.from(
      { length: 9 },
      (_, i) => `INV-${i},A,D,10,USD,false,已驗收`,
    ).join('\n');
  assert.throws(() => parseAgentCsv(tooMany, defaultPolicy, 1000), ApiError);
});

void test('custom model workflow isolates department inputs, preserves raw responses and enforces cumulative department budget', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const input = parseAgentCsv(agentCsvTemplate, defaultPolicy, 1_000_000);
    const units = [...new Set(input.invoices.map((i) => i.entity))];
    let calls = 0;
    const trace = await generateAgentTrace(
      'http://model.test',
      'test-model',
      async (_url, init) => {
        assert.equal(typeof init?.body, 'string');
        const body = JSON.parse(init!.body as string);
        const unit = units[calls++];
        for (const invoice of input.invoices)
          assert.equal(
            body.messages[0].content.includes(invoice.id),
            invoice.entity === unit,
          );
        assert.equal(body.format.properties.decisions.minItems, 2);
        // Deliberately recommend too much. Model proposals never authorize spending.
        const decisions = input.invoices
          .filter((i) => i.entity === unit)
          .map((i) => ({
            invoiceId: i.id,
            action: 'PAY',
            reason: '測試模型故意提出全部付款，交由後端檢查預算。',
          }));
        return Response.json({
          done: true,
          model: 'test-model',
          message: { content: JSON.stringify({ decisions }) },
        });
      },
      input,
    );
    assert.equal(calls, 3);
    assert.equal(trace.version, 2);
    assert.equal(await verifyAgentTrace(trace), true);
    assert.deepEqual(
      agentIntents(trace).map((i) => i.amount),
      input.invoices.map((i) => i.amount),
    );
    const repo = createAssuranceRepository(database, 'alice');
    const run = await repo.createAgentRun(trace, 0, crypto.randomUUID());
    assert.deepEqual(await repo.getStoredRun(run.runId), run);
    const suggested = suggestRelease(
      run.risk.intents,
      run.policy,
      input.departmentBudgetUsd,
    );
    assert.deepEqual(suggested, ['INV-HSC-01', 'INV-TPE-01', 'INV-TXG-01']);
    assert.equal(
      planRelease(
        run.risk.intents,
        3,
        true,
        run.policy,
        suggested,
        input.departmentBudgetUsd,
      ).allowed,
      true,
    );
    await repo.releaseIntents(run.runId, {
      ...approval,
      count: 3,
      intentIds: suggested,
      expectedAuditHead: run.auditHead!,
    });
    const after = (await repo.getStoredRun(run.runId))!;
    await assert.rejects(
      repo.releaseIntents(run.runId, {
        ...approval,
        count: 1,
        intentIds: ['INV-TPE-02'],
        idempotencyKey: 'workflow:over-budget',
        expectedAuditHead: after.auditHead!,
      }),
      (e: unknown) =>
        e instanceof ApiError &&
        e.code === 'HB_DEPARTMENT_LIMIT' &&
        e.status === 422,
    );
    assert.deepEqual(await repo.getStoredRun(run.runId), after);
    assert.ok(
      Object.values(
        await verifyEvidence(await repo.getEvidence(run.runId)),
      ).every((v) => v !== false),
    );
    const tampered = structuredClone(trace);
    tampered.input!.invoices[0].amount = 1;
    assert.equal(await verifyAgentTrace(tampered), false);
    const dishonest = structuredClone(trace);
    dishonest.sessions[0].decisions[0].action = 'DELAY';
    dishonest.contentHash = await traceHash(dishonest);
    assert.equal(
      await verifyAgentTrace(dishonest),
      false,
      'rehashed trace must still agree with original model output',
    );
  } finally {
    sqlite.close();
  }
});
