import { AgentAction, IntentStatus, PaymentIntent, RiskResult, ScenarioId, runRiskEngine, scenarios, selectSafeRelease } from '@/lib/herdbrake';
import { makeAuditEvent, sha256Hex, stableStringify, verifyAuditChain } from '@/lib/assurance-core';
import { getDatabase } from './db';

type RunRow = {
  id: string; scenario_id: ScenarioId; severity: number; liquidity_floor: number; state: RiskResult['state']; reason_code: string;
  directional_agreement: number; destination_concentration: number; proposed_outflow: number; projected_buffer: number; created_at: string; updated_at: string;
};
type IntentRow = { run_id: string; intent_id: string; entity: string; action: AgentAction; destination: string; amount: number; currency: PaymentIntent['currency']; individual_policy: 'PASS'; status: IntentStatus; critical: number; nonce: string; commitment: string; released_at: string | null };
type AuditRow = { id: string; run_id: string; event_type: string; detail_json: string; previous_hash: string | null; event_hash: string; created_at: string };

export type StoredRun = { runId: string; scenarioId: ScenarioId; severity: number; createdAt: string; risk: RiskResult; commitments: Record<string, string>; auditHead: string | null };

export async function getLatestStoredRun() {
  const latest = await getDatabase().prepare('SELECT id FROM stress_runs ORDER BY created_at DESC LIMIT 1').first<{ id: string }>();
  return latest ? getStoredRun(latest.id) : null;
}

export async function createStressRun(input: { scenarioId: ScenarioId; severity: number; liquidityFloor: number }): Promise<StoredRun> {
  validateScenario(input.scenarioId); validateSeverity(input.severity); validateFloor(input.liquidityFloor);
  const database = getDatabase(); const runId = `RUN-${crypto.randomUUID()}`; const createdAt = new Date().toISOString();
  const risk = runRiskEngine({ scenarioId: input.scenarioId, severity: input.severity, liquidityFloor: input.liquidityFloor });
  const commitments = Object.fromEntries(await Promise.all(risk.intents.map(async (intent) => [intent.id, await sha256Hex(stableStringify({ runId, ...intent }))])));
  const auditInputs = [
    { type: 'SCENARIO_RECEIVED', detail: { scenarioId: input.scenarioId, source: scenarios.find((item) => item.id === input.scenarioId)?.commonSignal ?? 'unknown' } },
    { type: 'INTENTS_EVALUATED', detail: { count: risk.intents.length, individualPass: risk.intents.every((item) => item.individualPolicy === 'PASS'), directionalAgreement: risk.directionalAgreement } },
    { type: risk.state === 'CRITICAL' ? 'BREAKER_TRIGGERED' : 'BATCH_REVIEWED', detail: { state: risk.state, reasonCode: risk.reasonCode, projectedBuffer: risk.projectedBuffer, liquidityFloor: risk.liquidityFloor } },
  ];
  const audits = await buildAuditChain(runId, auditInputs, createdAt);
  const statements: D1PreparedStatement[] = [database.prepare(`INSERT INTO stress_runs (id, scenario_id, severity, liquidity_floor, state, reason_code, directional_agreement, destination_concentration, proposed_outflow, projected_buffer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(runId, input.scenarioId, input.severity, input.liquidityFloor, risk.state, risk.reasonCode, risk.directionalAgreement, risk.destinationConcentration, risk.proposedOutflow, risk.projectedBuffer, createdAt, createdAt)];
  for (const intent of risk.intents) statements.push(database.prepare(`INSERT INTO payment_intents (run_id, intent_id, entity, action, destination, amount, currency, individual_policy, status, critical, nonce, commitment, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(runId, intent.id, intent.entity, intent.action, intent.destination, intent.amount, intent.currency, intent.individualPolicy, intent.status, intent.critical ? 1 : 0, intent.nonce, commitments[intent.id]));
  for (const audit of audits) statements.push(database.prepare(`INSERT INTO audit_events (id, run_id, event_type, detail_json, previous_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(audit.id, runId, audit.eventType, audit.detailJson, audit.previousHash, audit.eventHash, audit.createdAt));
  await database.batch(statements);
  return { runId, scenarioId: input.scenarioId, severity: input.severity, createdAt, risk, commitments, auditHead: audits.at(-1)?.eventHash ?? null };
}

export async function getStoredRun(runId: string): Promise<StoredRun | null> {
  validateRunId(runId);
  const database = getDatabase(); const run = await database.prepare('SELECT * FROM stress_runs WHERE id = ?').bind(runId).first<RunRow>();
  if (!run) return null;
  const rows = await database.prepare('SELECT * FROM payment_intents WHERE run_id = ? ORDER BY intent_id').bind(runId).all<IntentRow>();
  const intents = rows.results.map(toIntent); const releasedIds = intents.filter((item) => item.status === 'RELEASED').map((item) => item.id);
  const risk = runRiskEngine({ scenarioId: run.scenario_id, severity: run.severity, liquidityFloor: run.liquidity_floor, releasedIds });
  const head = await database.prepare('SELECT event_hash FROM audit_events WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').bind(runId).first<{ event_hash: string }>();
  return { runId, scenarioId: run.scenario_id, severity: run.severity, createdAt: run.created_at, risk, commitments: Object.fromEntries(rows.results.map((row) => [row.intent_id, row.commitment])), auditHead: head?.event_hash ?? null };
}

export async function releaseIntents(runId: string, input: { count: number; prioritizeCritical: boolean; idempotencyKey: string }) {
  validateRunId(runId);
  validateCount(input.count); if (!/^[A-Za-z0-9:_-]{8,100}$/.test(input.idempotencyKey)) throw new InputError('A valid idempotency key is required.');
  const database = getDatabase();
  const replay = await database.prepare('SELECT response_json FROM idempotency_keys WHERE run_id = ? AND key = ?').bind(runId, input.idempotencyKey).first<{ response_json: string }>();
  if (replay) return { ...JSON.parse(replay.response_json) as object, idempotentReplay: true };
  const stored = await getStoredRun(runId); if (!stored) throw new NotFoundError('Stress run not found.');
  const held = stored.risk.intents.filter((item) => item.status === 'HELD'); const ids = input.prioritizeCritical ? selectSafeRelease(held, input.count) : held.slice(0, input.count).map((item) => item.id);
  const releasedAt = new Date().toISOString(); const previousHash = stored.auditHead;
  const detail = { releasedIntentIds: ids, prioritizeCritical: input.prioritizeCritical, authorization: 'human-confirmed', remainingHeld: Math.max(0, held.length - ids.length) };
  const event = await makeAuditEvent(runId, 'STAGED_RELEASE_AUTHORIZED', detail, previousHash, releasedAt);
  const response = { runId, releasedIntentIds: ids, releasedCount: ids.length, remainingHeld: detail.remainingHeld, auditHead: event.eventHash, idempotentReplay: false };
  const statements = ids.map((id) => database.prepare(`UPDATE payment_intents SET status = 'RELEASED', released_at = ? WHERE run_id = ? AND intent_id = ? AND status = 'HELD'`).bind(releasedAt, runId, id));
  statements.push(database.prepare('INSERT INTO audit_events (id, run_id, event_type, detail_json, previous_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(event.id, runId, event.eventType, event.detailJson, event.previousHash, event.eventHash, event.createdAt));
  statements.push(database.prepare('INSERT INTO idempotency_keys (key, run_id, operation, response_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(input.idempotencyKey, runId, 'STAGED_RELEASE', JSON.stringify(response), releasedAt));
  statements.push(database.prepare('UPDATE stress_runs SET updated_at = ? WHERE id = ?').bind(releasedAt, runId));
  await database.batch(statements); return response;
}

export async function runReplayProbe(runId: string) {
  validateRunId(runId);
  const database = getDatabase(); const stored = await getStoredRun(runId); if (!stored) throw new NotFoundError('Stress run not found.');
  const target = stored.risk.intents[0]; const createdAt = new Date().toISOString(); const detail = { blocked: true, nonce: target.nonce, intentId: target.id, reason: 'NONCE_ALREADY_REGISTERED', fundsMoved: false };
  const event = await makeAuditEvent(runId, 'REPLAY_BLOCKED', detail, stored.auditHead, createdAt);
  await database.prepare('INSERT INTO audit_events (id, run_id, event_type, detail_json, previous_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(event.id, runId, event.eventType, event.detailJson, event.previousHash, event.eventHash, event.createdAt).run();
  return { runId, ...detail, auditHead: event.eventHash };
}

export async function getEvidence(runId: string) {
  validateRunId(runId);
  const database = getDatabase(); const stored = await getStoredRun(runId); if (!stored) throw new NotFoundError('Stress run not found.');
  const result = await database.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY created_at, id').bind(runId).all<AuditRow>();
  const audits = result.results.map((row) => ({ id: row.id, eventType: row.event_type, detail: JSON.parse(row.detail_json), previousHash: row.previous_hash, eventHash: row.event_hash, createdAt: row.created_at }));
  const chainValid = await verifyAuditChain(runId, audits); const evidence = { schemaVersion: '1.0', generatedAt: new Date().toISOString(), product: 'HerdBrake Taiwan', run: stored, audit: { chainValid, events: audits }, controls: { custody: false, autonomousSigning: false, deterministicBreaker: true, humanAuthorizationRequired: true } };
  return { ...evidence, evidenceHash: await sha256Hex(stableStringify(evidence)) };
}

async function buildAuditChain(runId: string, inputs: Array<{ type: string; detail: unknown }>, timestamp: string) { const events: Awaited<ReturnType<typeof buildAuditEvent>>[] = []; let previous: string | null = null; for (let index = 0; index < inputs.length; index += 1) { const createdAt = new Date(new Date(timestamp).getTime() + index).toISOString(); const event = await buildAuditEvent(runId, inputs[index].type, inputs[index].detail, previous, createdAt); events.push(event); previous = event.eventHash; } return events; }
async function buildAuditEvent(runId: string, eventType: string, detail: unknown, previousHash: string | null, createdAt: string) { return makeAuditEvent(runId, eventType, detail, previousHash, createdAt); }
function toIntent(row: IntentRow): PaymentIntent { return { id: row.intent_id, entity: row.entity, action: row.action, destination: row.destination, amount: row.amount, currency: row.currency, individualPolicy: row.individual_policy, status: row.status, critical: Boolean(row.critical), nonce: row.nonce }; }
function validateScenario(value: string): asserts value is ScenarioId { if (!scenarios.some((item) => item.id === value)) throw new InputError('Unknown scenario.'); }
function validateSeverity(value: number) { if (!Number.isFinite(value) || value < 0.1 || value > 1) throw new InputError('Severity must be between 0.1 and 1.'); }
function validateFloor(value: number) { if (!Number.isInteger(value) || value < 50 || value > 95) throw new InputError('Liquidity floor must be an integer from 50 to 95.'); }
function validateCount(value: number) { if (!Number.isInteger(value) || value < 1 || value > 10) throw new InputError('Release count must be an integer from 1 to 10.'); }
function validateRunId(value: string) { if (!/^RUN-[0-9a-f-]{36}$/.test(value)) throw new InputError('Invalid run identifier.'); }
export class InputError extends Error { status = 400; }
export class NotFoundError extends Error { status = 404; }
