import assert from 'node:assert/strict';
import test from 'node:test';
import { testDatabase } from './helpers/database.ts';
import { createAssuranceRepository } from '../lib/server/assurance-repository.ts';
import { createWorkspaceRepository } from '../lib/server/workspace-repository.ts';
import { defaultPolicy, parsePolicy } from '../lib/policy.ts';
import {
  csvTemplate,
  intentsCsv,
  parseCsv,
  previewImport,
} from '../lib/import-csv.ts';
import { ApiError, ConflictError, NotFoundError } from '../lib/errors.ts';
const input = {
  scenarioId: 'stablecoin' as const,
  severity: 1,
  liquidityFloor: 75,
};
const authorization = {
  count: 2,
  prioritizeCritical: true,
  confirmed: true as const,
  authorizationReason: 'Verified supplier details',
  idempotencyKey: 'isolation:release',
};
void test('CSV handles BOM, CRLF, quoted commas, escaped quotes and reordered columns', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"one, two","a""b"\r\n'), [
    ['a', 'b'],
    ['one, two', 'a"b'],
  ]);
  assert.deepEqual(parseCsv('a\n"two\nlines"'), [['a'], ['two\nlines']]);
  const value = previewImport(
    'currency,amount,entity,action,destination,critical\nTWD,320,"Acme, Inc.",PAY,MAIN,true',
    defaultPolicy,
  );
  assert.equal(value.issues.length, 0);
  assert.equal(value.intents[0].entity, 'Acme, Inc.');
  assert.equal(value.intents[0].amount, 320);
  assert.equal(value.intents[0].critical, true);
});
void test('CSV reports invalid rows and cannot bypass limits through malformed numeric values', () => {
  for (const amount of [
    '0',
    '-1',
    'Infinity',
    '1e4',
    '1.001',
    '9007199254740992',
    '1000001',
  ]) {
    const result = previewImport(
      `entity,action,destination,amount,currency,critical\nEntity,PAY,MAIN,${amount},USD,true`,
      defaultPolicy,
    );
    assert.equal(result.intents.length, 0);
    assert.equal(result.issues[0].row, 2);
  }
  for (const csv of [
    'entity,action\nA,PAY',
    'a,b\n"oops',
    'a,b\n"a"oops,b',
    'x'.repeat(32769),
    csvTemplate.split('\n')[0],
  ])
    assert.throws(() => previewImport(csv, defaultPolicy), ApiError);
  const header = csvTemplate.split('\n')[0];
  const row = 'A,PAY,B,100,USD,false';
  assert.equal(
    previewImport(header + '\n' + Array(50).fill(row).join('\n'), defaultPolicy)
      .intents.length,
    50,
  );
  assert.throws(
    () =>
      previewImport(
        header + '\n' + Array(51).fill(row).join('\n'),
        defaultPolicy,
      ),
    ApiError,
  );
  const invalid = previewImport(
    header + '\nA,OTHER,B,100,EUR,yes',
    defaultPolicy,
  );
  assert.equal(invalid.issues.length, 3);
});
void test('CSV exports neutralize spreadsheet formulas without corrupting quoted text', () => {
  const intent = previewImport(csvTemplate, defaultPolicy).intents[0];
  const parsed = parseCsv(
    intentsCsv([
      { ...intent, entity: '=SUM(1,2)', destination: '@EVIL', amount: 125.5 },
    ]),
  );
  assert.equal(parsed[1][1], "'=SUM(1,2)");
  assert.equal(parsed[1][3], "'@EVIL");
  assert.equal(parsed[1][4], '125.5');
});
void test('policies reject coerced numbers, nonfinite values and fractional buffer floors', () => {
  for (const invalid of [
    { ...defaultPolicy, twdPerUsd: 0 },
    { ...defaultPolicy, maxIntentUsd: Infinity },
    { ...defaultPolicy, openingLiquidity: '32000' },
    { ...defaultPolicy, liquidityFloor: 75.5 },
  ])
    assert.throws(() => parsePolicy(invalid), ApiError);
  assert.deepEqual(parsePolicy(defaultPolicy), defaultPolicy);
});
void test('every stored operation is owner-scoped including idempotent replay and evidence', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const alice = createAssuranceRepository(database, 'alice');
    const bob = createAssuranceRepository(database, 'bob');
    const run = await alice.createStressRun(input);
    await alice.releaseIntents(run.runId, authorization);
    assert.equal(await bob.getLatestStoredRun(), null);
    assert.equal(await bob.getStoredRun(run.runId), null);
    assert.equal((await bob.listRuns()).total, 0);
    assert.deepEqual((await bob.listRuns()).summary, {
      runCount: 0,
      criticalCount: 0,
      heldCount: 0,
      releasedCount: 0,
    });
    await assert.rejects(
      bob.releaseIntents(run.runId, authorization),
      NotFoundError,
    );
    await assert.rejects(bob.runReplayProbe(run.runId), NotFoundError);
    await assert.rejects(bob.getEvidence(run.runId), NotFoundError);
    sqlite
      .prepare('UPDATE stress_runs SET owner_id=NULL WHERE id=?')
      .run(run.runId);
    assert.equal(await alice.getStoredRun(run.runId), null);
    assert.equal((await alice.listRuns()).total, 0);
  } finally {
    sqlite.close();
  }
});
void test('CSV batches persist their actual size, complete review and preserve policy snapshots', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const repo = createAssuranceRepository(database, 'alice');
    const settings = createWorkspaceRepository(database, 'alice');
    const first = await settings.updateSettings({
      name: 'Finance',
      revision: 0,
      policy: { ...defaultPolicy, twdPerUsd: 40 },
    });
    const run = await repo.importRun({
      name: 'September suppliers',
      csv: csvTemplate,
      policyRevision: first.revision,
    });
    assert.equal(run.intentCount, 3);
    assert.equal(run.source, 'import');
    assert.equal(run.name, 'September suppliers');
    assert.deepEqual(await repo.getStoredRun(run.runId), run);
    await settings.updateSettings({
      ...first,
      policy: { ...first.policy, twdPerUsd: 25 },
    });
    assert.deepEqual((await repo.getStoredRun(run.runId))?.risk, run.risk);
    assert.equal((await repo.getEvidence(run.runId)).policyValid, true);
    await assert.rejects(
      repo.importRun({ name: 'Outdated', csv: csvTemplate, policyRevision: 1 }),
      ConflictError,
    );
    const result = await repo.releaseIntents(run.runId, {
      ...authorization,
      count: 10,
    });
    assert.equal(result.releasedCount, 3);
    assert.equal(result.remainingHeld, 0);
    const evidence = await repo.getEvidence(run.runId);
    assert.equal(evidence.commitmentsValid, true);
    assert.equal(evidence.releaseStateValid, true);
    assert.equal(evidence.audit.chainValid, true);
    assert.equal((await repo.listRuns({ search: 'September' })).total, 1);
    assert.equal((await repo.listRuns({ search: 'absent' })).total, 0);
    assert.equal((await repo.listRuns()).summary.releasedCount, 3);
  } finally {
    sqlite.close();
  }
});
void test('policy revisions use atomic optimistic locking and isolate settings and history', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const repo = createWorkspaceRepository(database, 'alice');
    const bob = createWorkspaceRepository(database, 'bob');
    const results = await Promise.allSettled([
      repo.updateSettings({
        name: 'First',
        revision: 0,
        policy: defaultPolicy,
      }),
      repo.updateSettings({
        name: 'Second',
        revision: 0,
        policy: { ...defaultPolicy, twdPerUsd: 33 },
      }),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const loser = results.find((result) => result.status === 'rejected');
    assert.ok(
      loser?.status === 'rejected' && loser.reason instanceof ConflictError,
    );
    assert.equal((await repo.getSettings()).revision, 1);
    assert.equal((await repo.history()).length, 1);
    assert.equal((await bob.getSettings()).revision, 0);
    assert.deepEqual(await bob.history(), []);
  } finally {
    sqlite.close();
  }
});
void test('policy and batch metadata tampering prevent authorization and replay probes', async () => {
  for (const column of [
    'policy_json',
    'liquidity_floor',
    'intent_count',
    'name',
  ]) {
    const { database, sqlite } = testDatabase();
    try {
      const repo = createAssuranceRepository(database, 'alice');
      const run = await repo.createStressRun(input);
      const values = {
        policy_json: JSON.stringify({ ...run.policy, twdPerUsd: 1 }),
        liquidity_floor: 90,
        intent_count: 1,
        name: 'Altered',
      };
      sqlite
        .prepare(`UPDATE stress_runs SET ${column}=? WHERE id=?`)
        .run(values[column as keyof typeof values], run.runId);
      assert.equal((await repo.getEvidence(run.runId)).policyValid, false);
      await assert.rejects(
        repo.releaseIntents(run.runId, authorization),
        ConflictError,
      );
      await assert.rejects(repo.runReplayProbe(run.runId), ConflictError);
    } finally {
      sqlite.close();
    }
  }
});
void test('mutation rate limits are enforced per owner', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const alice = createWorkspaceRepository(database, 'alice');
    const bob = createWorkspaceRepository(database, 'bob');
    for (let index = 0; index < 60; index++) await alice.consumeMutationLimit();
    await assert.rejects(
      alice.consumeMutationLimit(),
      (error: unknown) => error instanceof ApiError && error.status === 429,
    );
    await bob.consumeMutationLimit();
  } finally {
    sqlite.close();
  }
});
void test('list pagination has stable ordering and cannot cross owner filters', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const alice = createAssuranceRepository(database, 'alice');
    const bob = createAssuranceRepository(database, 'bob');
    for (let index = 0; index < 22; index++)
      await alice.importRun({
        name: `batch-${index}`,
        csv: csvTemplate,
        policyRevision: 0,
      });
    await bob.importRun({
      name: 'batch-bob',
      csv: csvTemplate,
      policyRevision: 0,
    });
    const first = await alice.listRuns();
    const second = await alice.listRuns({ page: 1 });
    assert.equal(first.total, 22);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 2);
    assert.equal(
      new Set(
        [...first.items, ...second.items].map(
          (item) => (item as { id: string }).id,
        ),
      ).size,
      22,
    );
    await assert.rejects(alice.listRuns({ state: 'INVALID' }), ApiError);
    await assert.rejects(alice.listRuns({ page: -1 }), ApiError);
  } finally {
    sqlite.close();
  }
});

void test('imported destinations cannot collide with object prototype keys', async () => {
  const { database, sqlite } = testDatabase();
  try {
    const repo = createAssuranceRepository(database, 'alice');
    for (const destination of ['__proto__', 'constructor', 'toString']) {
      const run = await repo.importRun({
        name: 'Special destination',
        csv: `entity,action,destination,amount,currency,critical\nEntity,PAY,${destination},100,USD,false`,
        policyRevision: 0,
      });
      assert.equal(run.risk.destinationConcentration, 100);
      assert.equal((await repo.getEvidence(run.runId)).commitmentsValid, true);
    }
  } finally {
    sqlite.close();
  }
});
