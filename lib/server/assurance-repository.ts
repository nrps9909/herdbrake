import { defaultPolicy } from '../policy.ts';
import { agentIntents, verifyAgentTrace } from '../agent-workflow.ts';
import type { AgentTrace } from '../agent-workflow.ts';
import type { RiskPolicy } from '../policy.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';
import { previewImport } from '../import-csv.ts';
import { planRelease, releasePosition } from '../release-plan.ts';
import { ApiError } from '../errors.ts';
import {
  evaluateRisk,
  amountInUsd,
  runRiskEngine,
  scenarios,
} from '../herdbrake.ts';
import type { PaymentIntent, ScenarioId } from '../herdbrake.ts';
import {
  makeAuditEvent,
  sha256Hex,
  stableStringify,
  verifyAuditChain,
} from '../assurance-core.ts';
import type { HashAuditEvent } from '../assurance-core.ts';
import {
  parseRunInput,
  parseReleaseInput,
  validateRunId,
} from '../contracts.ts';
import type {
  RunInput,
  ReleaseInput,
  StoredRun,
  ReleaseResult,
  ReplayResult,
} from '../contracts.ts';
import { ConflictError, NotFoundError } from '../errors.ts';

type RunRow = {
  id: string;
  scenario_id: ScenarioId;
  severity: number;
  liquidity_floor: number;
  created_at: string;
  revision: number;
  name: string;
  source: 'scenario' | 'import' | 'ai';
  policy_json: string | null;
  policy_revision: number;
  intent_count: number;
};
type IntentRow = {
  intent_id: string;
  entity: string;
  action: PaymentIntent['action'];
  destination: string;
  amount: number;
  currency: PaymentIntent['currency'];
  individual_policy: 'PASS';
  status: PaymentIntent['status'];
  critical: number;
  nonce: string;
  commitment: string;
};
type AuditRow = {
  id: string;
  event_type: string;
  detail_json: string;
  previous_hash: string | null;
  event_hash: string;
  created_at: string;
  sequence: number;
};
type IdempotencyRow = { response_json: string; request_hash: string | null };

// A request-scoped repository makes the engine testable without Cloudflare globals.
export function createAssuranceRepository(
  database: D1Database,
  ownerId: string,
) {
  if (!ownerId) throw new ApiError('請先登入。', 401, 'HB_UNAUTHENTICATED');
  const workspace = createWorkspaceRepository(database, ownerId);
  const statement = (sql: string, ...values: unknown[]) =>
    database.prepare(sql).bind(...values);
  const auditStatement = (
    runId: string,
    event: HashAuditEvent,
    sequence: number,
  ) =>
    statement(
      'INSERT INTO audit_events (id, run_id, event_type, detail_json, previous_hash, event_hash, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      event.id,
      runId,
      event.eventType,
      event.detailJson,
      event.previousHash,
      event.eventHash,
      event.createdAt,
      sequence,
    );

  async function getLatestStoredRun() {
    const latest = await database
      .prepare(
        'SELECT id FROM stress_runs WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      )
      .bind(ownerId)
      .first<{ id: string }>();
    return latest ? getStoredRun(latest.id) : null;
  }

  async function createStressRun(
    value: RunInput,
    imported?: {
      name: string;
      intents: PaymentIntent[];
      policy: RiskPolicy;
      policyRevision: number;
      aiTrace?: AgentTrace;
      requestId?: string;
    },
  ): Promise<StoredRun> {
    const input = parseRunInput(value);
    const runId = `RUN-${imported?.requestId ?? crypto.randomUUID()}`;
    validateRunId(runId);
    const createdAt = new Date().toISOString();
    const settings = await workspace.getSettings();
    const policy = imported?.policy ?? {
      ...settings.policy,
      liquidityFloor: input.liquidityFloor,
    };
    const policyRevision = imported?.policyRevision ?? settings.revision;
    const source = imported?.aiTrace
      ? ('ai' as const)
      : imported
        ? ('import' as const)
        : ('scenario' as const);
    const name =
      imported?.name ??
      scenarios.find((item) => item.id === input.scenarioId)!.shortName +
        '壓力測試';
    const risk = evaluateRisk(
      imported?.intents ?? runRiskEngine(input).intents,
      input.liquidityFloor,
      policy,
    );
    if (
      risk.intents.some(
        (intent) => amountInUsd(intent, policy) > policy.maxIntentUsd,
      )
    )
      throw new ApiError(
        '情境內的金額超過目前單筆上限，請調整政策或匯入符合限額的清單。',
        422,
        'HB_INTENT_LIMIT',
      );
    const commitments = Object.fromEntries(
      await Promise.all(
        risk.intents.map(async (intent) => [
          intent.id,
          await sha256Hex(stableStringify({ runId, ...intent })),
        ]),
      ),
    );
    const inputs = [
      {
        type: 'SCENARIO_RECEIVED',
        detail: {
          scenarioId: input.scenarioId,
          ownerId,
          name,
          policyRevision,
          policy,
          batchSource: source,
          ...(imported?.aiTrace ? { aiTrace: imported.aiTrace } : {}),
          intentCount: risk.intents.length,
          liquidityFloor: input.liquidityFloor,
          source: imported?.aiTrace
            ? 'AI 代理付款提案'
            : imported
              ? 'CSV 匯入'
              : scenarios.find((item) => item.id === input.scenarioId)!
                  .commonSignal,
        },
      },
      {
        type: 'INTENTS_EVALUATED',
        detail: {
          count: risk.intents.length,
          individualPass: risk.intents.every(
            (item) => item.individualPolicy === 'PASS',
          ),
          directionalAgreement: risk.directionalAgreement,
        },
      },
      {
        type:
          risk.state === 'CRITICAL' ? 'BREAKER_TRIGGERED' : 'BATCH_REVIEWED',
        detail: {
          state: risk.state,
          reasonCode: risk.reasonCode,
          projectedBuffer: risk.projectedBuffer,
          liquidityFloor: risk.liquidityFloor,
        },
      },
    ];
    const auditEvents: HashAuditEvent[] = [];
    for (const event of inputs)
      auditEvents.push(
        await makeAuditEvent(
          runId,
          event.type,
          event.detail,
          auditEvents.at(-1)?.eventHash ?? null,
          createdAt,
        ),
      );
    await database.batch([
      statement(
        'INSERT INTO stress_runs (id, scenario_id, severity, liquidity_floor, state, reason_code, directional_agreement, destination_concentration, proposed_outflow, projected_buffer, created_at, updated_at, revision, owner_id, name, source, policy_json, policy_revision, intent_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        runId,
        input.scenarioId,
        input.severity,
        input.liquidityFloor,
        risk.state,
        risk.reasonCode,
        risk.directionalAgreement,
        risk.destinationConcentration,
        risk.proposedOutflow,
        risk.projectedBuffer,
        createdAt,
        createdAt,
        auditEvents.length,
        ownerId,
        name,
        source,
        JSON.stringify(policy),
        policyRevision,
        risk.intents.length,
      ),
      ...risk.intents.map((intent) =>
        statement(
          'INSERT INTO payment_intents (run_id, intent_id, entity, action, destination, amount, currency, individual_policy, status, critical, nonce, commitment, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
          runId,
          intent.id,
          intent.entity,
          intent.action,
          intent.destination,
          intent.amount,
          intent.currency,
          intent.individualPolicy,
          intent.status,
          Number(intent.critical),
          intent.nonce,
          commitments[intent.id],
        ),
      ),
      ...auditEvents.map((event, index) =>
        auditStatement(runId, event, index + 1),
      ),
    ]);
    return {
      ...input,
      runId,
      name,
      source,
      ...(imported?.aiTrace ? { aiTrace: imported.aiTrace } : {}),
      policy,
      policyRevision,
      intentCount: risk.intents.length,
      createdAt,
      risk,
      commitments,
      auditHead: auditEvents.at(-1)!.eventHash,
      revision: auditEvents.length,
      auditEvents,
    };
  }

  async function getStoredRun(runId: string): Promise<StoredRun | null> {
    validateRunId(runId);
    // D1 batch provides a consistent snapshot and saves two network round trips.
    const results = await database.batch([
      statement(
        'SELECT * FROM stress_runs WHERE id = ? AND owner_id = ?',
        runId,
        ownerId,
      ),
      statement(
        'SELECT * FROM payment_intents WHERE run_id = ? AND EXISTS (SELECT 1 FROM stress_runs WHERE id = ? AND owner_id = ?) ORDER BY intent_id',
        runId,
        runId,
        ownerId,
      ),
      statement(
        'SELECT * FROM audit_events WHERE run_id = ? AND EXISTS (SELECT 1 FROM stress_runs WHERE id = ? AND owner_id = ?) ORDER BY sequence',
        runId,
        runId,
        ownerId,
      ),
    ]);
    const row = results[0].results[0] as RunRow | undefined;
    if (!row) return null;
    const rows = results[1].results as IntentRow[];
    const auditEvents = (results[2].results as AuditRow[]).map(toAuditEvent);
    return {
      runId,
      name:
        row.name ||
        scenarios.find((item) => item.id === row.scenario_id)?.shortName ||
        '未命名批次',
      source: row.source,
      ...((auditEvents[0]?.detail as { aiTrace?: AgentTrace } | undefined)
        ?.aiTrace
        ? {
            aiTrace: (auditEvents[0].detail as { aiTrace: AgentTrace }).aiTrace,
          }
        : {}),
      policy: row.policy_json ? JSON.parse(row.policy_json) : defaultPolicy,
      policyRevision: row.policy_revision,
      intentCount: row.intent_count,
      scenarioId: row.scenario_id,
      severity: row.severity,
      liquidityFloor: row.liquidity_floor,
      createdAt: row.created_at,
      revision: row.revision,
      risk: evaluateRisk(
        rows.map(toIntent),
        row.liquidity_floor,
        row.policy_json ? JSON.parse(row.policy_json) : defaultPolicy,
      ),
      commitments: Object.fromEntries(
        rows.map((intent) => [intent.intent_id, intent.commitment]),
      ),
      auditHead: auditEvents.at(-1)?.eventHash ?? null,
      auditEvents,
    };
  }

  async function findReplay(
    runId: string,
    key: string,
    requestHash: string,
  ): Promise<ReleaseResult | null> {
    const row = await statement(
      'SELECT response_json, request_hash FROM idempotency_keys WHERE run_id = ? AND key = ?',
      runId,
      key,
    ).first<IdempotencyRow>();
    if (!row) return null;
    // Legacy keys have no payload hash: fail closed instead of treating a new payload as authorized.
    if (row.request_hash !== requestHash)
      throw new ConflictError(
        'Idempotency key is already bound to another request.',
      );
    return {
      ...(JSON.parse(row.response_json) as ReleaseResult),
      idempotentReplay: true,
    };
  }

  async function releaseIntents(
    runId: string,
    value: ReleaseInput,
  ): Promise<ReleaseResult> {
    validateRunId(runId);
    await requireRun(runId);
    const input = parseReleaseInput(value);
    const { idempotencyKey, ...request } = input;
    const requestHash = await sha256Hex(stableStringify(request));
    const replay = await findReplay(runId, idempotencyKey, requestHash);
    if (replay) return replay;
    const stored = await requireRun(runId);
    if (input.expectedAuditHead && stored.auditHead !== input.expectedAuditHead)
      throw new ConflictError();
    if (
      !(await verifyAuditChain(runId, stored.auditEvents)) ||
      stored.auditEvents.length !== stored.revision
    )
      throw new ConflictError('Audit chain is invalid. Release is blocked.');
    if (!verifyPolicy(stored, ownerId))
      throw new ConflictError('政策快照與原始紀錄不符，已停止核准。');
    if (!(await verifyCommitments(stored)))
      throw new ConflictError(
        'Intent commitments are invalid. Release is blocked.',
      );
    if (!verifyReleaseState(stored))
      throw new ConflictError('Release state does not match the audit trail.');
    const held = stored.risk.intents.filter(
      (intent) => intent.status === 'HELD',
    );
    const plan = planRelease(
      stored.risk.intents,
      input.count,
      input.prioritizeCritical,
      stored.policy,
    );
    const ids = plan.ids;
    if (!ids.length) throw new ConflictError('No held intents remain.');
    if (plan.overLimitIds.length)
      throw new ApiError(
        '本次付款超過批次政策的單筆上限，無法核准。',
        422,
        'HB_INTENT_LIMIT',
      );
    if (!plan.withinFloor)
      throw new ApiError(
        '累計核准金額將突破流動性底線，請減少本次筆數。',
        422,
        'HB_LIQUIDITY_FLOOR',
      );
    const createdAt = new Date().toISOString();
    const detail = {
      releasedIntentIds: ids,
      prioritizeCritical: input.prioritizeCritical,
      authorization: 'human-confirmed',
      authorizedBy: ownerId,
      authorizationReason: input.authorizationReason,
      remainingHeld: held.length - ids.length,
      liquidityCheck: {
        previousApprovedOutflow: plan.approvedOutflow,
        batchOutflow: plan.batchOutflow,
        projectedBuffer: plan.projectedBuffer,
        liquidityFloor: stored.policy.liquidityFloor,
        remainingBudget: plan.remainingBudget,
      },
    };
    const event = await makeAuditEvent(
      runId,
      'STAGED_RELEASE_AUTHORIZED',
      detail,
      stored.auditHead,
      createdAt,
    );
    const response: ReleaseResult = {
      runId,
      releasedIntentIds: ids,
      releasedCount: ids.length,
      remainingHeld: detail.remainingHeld,
      auditHead: event.eventHash,
      idempotentReplay: false,
    };
    try {
      await database.batch([
        // Unique (run_id, sequence) is the optimistic lock. A loser rolls back the ENTIRE batch.
        auditStatement(runId, event, stored.revision + 1),
        ...ids.map((id) =>
          statement(
            "UPDATE payment_intents SET status = 'RELEASED', released_at = ? WHERE run_id = ? AND intent_id = ? AND status = 'HELD'",
            createdAt,
            runId,
            id,
          ),
        ),
        statement(
          'INSERT INTO idempotency_keys (key, run_id, operation, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          idempotencyKey,
          runId,
          'STAGED_RELEASE',
          requestHash,
          JSON.stringify(response),
          createdAt,
        ),
        statement(
          'UPDATE stress_runs SET updated_at = ?, revision = ? WHERE id = ?',
          createdAt,
          stored.revision + 1,
          runId,
        ),
      ]);
    } catch (error) {
      const duplicate = await findReplay(runId, idempotencyKey, requestHash);
      if (duplicate) return duplicate;
      if ((await requireRun(runId)).revision !== stored.revision)
        throw new ConflictError();
      throw error;
    }
    return response;
  }

  async function runReplayProbe(runId: string): Promise<ReplayResult> {
    validateRunId(runId);
    const stored = await requireRun(runId);
    if (
      !(await verifyAuditChain(runId, stored.auditEvents)) ||
      stored.revision !== stored.auditEvents.length ||
      !(await verifyCommitments(stored)) ||
      !verifyPolicy(stored, ownerId) ||
      !verifyReleaseState(stored)
    )
      throw new ConflictError('批次證據異常，已停止重播檢查。');
    const target = stored.risk.intents[0];
    const probeId = `PROBE-${crypto.randomUUID()}`;
    if (!target) throw new ConflictError('No registered intent is available.');
    const createdAt = new Date().toISOString();
    const detail = {
      blocked: true as const,
      nonce: target.nonce,
      intentId: target.id,
      reason: 'NONCE_ALREADY_REGISTERED',
      fundsMoved: false as const,
    };
    const event = await makeAuditEvent(
      runId,
      'REPLAY_BLOCKED',
      detail,
      stored.auditHead,
      createdAt,
    );
    try {
      await database.batch([
        // Probe the real nonce uniqueness constraint without changing payment state.
        statement(
          'INSERT OR IGNORE INTO payment_intents (run_id, intent_id, entity, action, destination, amount, currency, individual_policy, status, critical, nonce, commitment, released_at) SELECT run_id, ?, entity, action, destination, amount, currency, individual_policy, status, critical, nonce, commitment, released_at FROM payment_intents WHERE run_id = ? AND nonce = ?',
          probeId,
          runId,
          target.nonce,
        ),
        // If the uniqueness constraint is missing, abort and roll back the clone.
        statement(
          'UPDATE payment_intents SET amount = NULL WHERE run_id = ? AND intent_id = ?',
          runId,
          probeId,
        ),
        auditStatement(runId, event, stored.revision + 1),
        statement(
          'UPDATE stress_runs SET updated_at = ?, revision = ? WHERE id = ?',
          createdAt,
          stored.revision + 1,
          runId,
        ),
      ]);
    } catch (error) {
      if ((await requireRun(runId)).revision !== stored.revision)
        throw new ConflictError();
      throw error;
    }
    return { runId, ...detail, auditHead: event.eventHash };
  }

  async function requireRun(runId: string) {
    const run = await getStoredRun(runId);
    if (!run) throw new NotFoundError();
    return run;
  }

  async function verifyCommitments(stored: StoredRun) {
    const checks = await Promise.all(
      stored.risk.intents.map(
        async (intent) =>
          stored.commitments[intent.id] ===
          (await sha256Hex(
            stableStringify({ runId: stored.runId, ...intent, status: 'HELD' }),
          )),
      ),
    );
    return (
      checks.length === stored.intentCount &&
      checks.length > 0 &&
      checks.every(Boolean)
    );
  }

  async function getEvidence(runId: string) {
    const stored = await requireRun(runId);
    const chainValid =
      stored.revision === stored.auditEvents.length &&
      (await verifyAuditChain(runId, stored.auditEvents));
    const commitmentsValid = await verifyCommitments(stored);
    const evidence = {
      schemaVersion: '2.0',
      generatedAt: new Date().toISOString(),
      product: 'HerdBrake Taiwan',
      run: stored,
      audit: { chainValid, events: stored.auditEvents },
      commitmentsValid,
      policyValid: verifyPolicy(stored, ownerId),
      releaseStateValid: verifyReleaseState(stored),
      releasePolicyValid:
        releasePosition(stored.risk.intents, stored.policy).withinFloor &&
        !stored.risk.intents.some(
          (intent) =>
            intent.status === 'RELEASED' &&
            amountInUsd(intent, stored.policy) > stored.policy.maxIntentUsd,
        ),
      releasePosition: releasePosition(stored.risk.intents, stored.policy),
      controls: {
        custody: false,
        autonomousSigning: false,
        deterministicBreaker: true,
        humanAuthorizationRequired: true,
      },
    };
    return {
      ...evidence,
      evidenceHash: await sha256Hex(stableStringify(evidence)),
    };
  }
  async function createAgentRun(
    trace: AgentTrace,
    policyRevision: number,
    requestId: string,
  ) {
    validateRunId(`RUN-${requestId}`);
    const existing = await getStoredRun(`RUN-${requestId}`);
    if (existing) {
      if (
        existing.source !== 'ai' ||
        existing.aiTrace?.mode !== trace.mode ||
        existing.policyRevision !== policyRevision
      )
        throw new ConflictError('此請求識別碼已用於其他 AI 提案。');
      return existing;
    }
    if (!(await verifyAgentTrace(trace)))
      throw new ApiError('AI 推論紀錄驗證失敗。', 422, 'HB_AI_INVALID');
    const settings = await workspace.getSettings();
    if (settings.revision !== policyRevision)
      throw new ConflictError('政策已更新，請重新載入後再執行。');
    try {
      return await createStressRun(
        {
          scenarioId: 'stablecoin',
          severity: 0.8,
          liquidityFloor: settings.policy.liquidityFloor,
        },
        {
          name: `AI 付款協作 · ${trace.mode === 'live' ? '即時推論' : '推論紀錄重現'}`,
          intents: agentIntents(trace),
          policy: settings.policy,
          policyRevision,
          aiTrace: trace,
          requestId,
        },
      );
    } catch (error) {
      // Concurrent retries may finish inference together. The run primary key
      // makes one transaction win; the loser returns that owned saved result.
      const winner = await getStoredRun(`RUN-${requestId}`);
      if (
        winner?.source === 'ai' &&
        winner.aiTrace?.mode === trace.mode &&
        winner.policyRevision === policyRevision
      )
        return winner;
      throw error;
    }
  }

  async function importRun(input: {
    name: string;
    csv: string;
    policyRevision: number;
  }) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 80)
      throw new ApiError('批次名稱需為 1 至 80 字元。');
    if (typeof input.csv !== 'string') throw new ApiError('請選擇 CSV 檔案。');
    const settings = await workspace.getSettings();
    if (input.policyRevision !== settings.revision)
      throw new ConflictError('政策已更新，請重新預覽後再匯入。');
    const preview = previewImport(input.csv, settings.policy);
    if (preview.issues.length)
      throw new ApiError(
        `第 ${preview.issues[0].row} 列：${preview.issues[0].message}，共 ${preview.issues.length} 處錯誤。`,
      );
    return createStressRun(
      {
        scenarioId: 'supplier',
        severity: 1,
        liquidityFloor: settings.policy.liquidityFloor,
      },
      {
        name,
        intents: preview.intents,
        policy: settings.policy,
        policyRevision: settings.revision,
      },
    );
  }

  async function listRuns(
    input: { search?: string; state?: string; page?: number } = {},
  ) {
    const search = (input.search ?? '').slice(0, 100);
    const state = input.state ?? 'ALL';
    const page = input.page ?? 0;
    if (
      !['ALL', 'CRITICAL', 'REVIEW', 'NORMAL'].includes(state) ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 10000
    )
      throw new ApiError('篩選條件錯誤。');
    const filter =
      "owner_id = ? AND (? = 'ALL' OR state = ?) AND (name LIKE ? OR id LIKE ?)";
    const args = [ownerId, state, state, `%${search}%`, `%${search}%`];
    const results = await database.batch([
      statement(
        `SELECT id, name, scenario_id AS scenarioId, source, state, reason_code AS reasonCode, projected_buffer AS projectedBuffer, proposed_outflow AS proposedOutflow, intent_count AS intentCount, created_at AS createdAt, (SELECT COUNT(*) FROM payment_intents WHERE run_id=stress_runs.id AND status='HELD') AS heldCount FROM stress_runs WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?`,
        ...args,
        page * 20,
      ),
      statement(
        `SELECT COUNT(*) AS total FROM stress_runs WHERE ${filter}`,
        ...args,
      ),
      statement(
        "SELECT COUNT(*) AS runCount, COALESCE(SUM(state='CRITICAL'),0) AS criticalCount FROM stress_runs WHERE owner_id = ?",
        ownerId,
      ),
      statement(
        "SELECT COALESCE(SUM(status='HELD'),0) AS heldCount, COALESCE(SUM(status='RELEASED'),0) AS releasedCount FROM payment_intents WHERE run_id IN (SELECT id FROM stress_runs WHERE owner_id = ?)",
        ownerId,
      ),
    ]);
    return {
      items: results[0].results,
      total: (results[1].results[0] as { total: number }).total,
      page,
      summary: {
        ...(results[2].results[0] as {
          runCount: number;
          criticalCount: number;
        }),
        ...(results[3].results[0] as {
          heldCount: number;
          releasedCount: number;
        }),
      },
    };
  }

  return {
    createAgentRun,
    importRun,
    listRuns,
    getLatestStoredRun,
    createStressRun,
    getStoredRun,
    releaseIntents,
    runReplayProbe,
    getEvidence,
  };
}

function toIntent(row: IntentRow): PaymentIntent {
  return {
    id: row.intent_id,
    entity: row.entity,
    action: row.action,
    destination: row.destination,
    amount: row.amount,
    currency: row.currency,
    individualPolicy: row.individual_policy,
    status: row.status,
    critical: Boolean(row.critical),
    nonce: row.nonce,
  };
}
function toAuditEvent(row: AuditRow): HashAuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    detail: JSON.parse(row.detail_json),
    detailJson: row.detail_json,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    createdAt: row.created_at,
  };
}

function verifyReleaseState(stored: StoredRun): boolean {
  const released = new Set<string>();
  const known = new Set(stored.risk.intents.map((intent) => intent.id));
  for (const event of stored.auditEvents) {
    if (event.eventType !== 'STAGED_RELEASE_AUTHORIZED') continue;
    const ids = (event.detail as { releasedIntentIds?: unknown } | null)
      ?.releasedIntentIds;
    if (!Array.isArray(ids)) return false;
    for (const id of ids) {
      if (typeof id !== 'string' || !known.has(id) || released.has(id))
        return false;
      released.add(id);
    }
  }
  return stored.risk.intents.every(
    (intent) =>
      intent.status === (released.has(intent.id) ? 'RELEASED' : 'HELD'),
  );
}

function verifyPolicy(stored: StoredRun, ownerId: string): boolean {
  const initial = stored.auditEvents[0]?.detail as
    | Record<string, unknown>
    | undefined;
  return Boolean(
    initial &&
    initial.ownerId === ownerId &&
    initial.name === stored.name &&
    initial.batchSource === stored.source &&
    initial.intentCount === stored.intentCount &&
    initial.policyRevision === stored.policyRevision &&
    initial.liquidityFloor === stored.liquidityFloor &&
    stableStringify(initial.policy) === stableStringify(stored.policy),
  );
}
