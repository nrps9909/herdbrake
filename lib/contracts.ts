import type { RiskPolicy } from './policy.ts';
import type { AgentTrace } from './agent-workflow.ts';

import type { HashAuditEvent } from './assurance-core.ts';
import { scenarios } from './herdbrake.ts';
import type { RiskResult, ScenarioId } from './herdbrake.ts';
import { ApiError } from './errors.ts';

export type RunInput = {
  scenarioId: ScenarioId;
  severity: number;
  liquidityFloor: number;
};
export type ReleaseInput = {
  count: number;
  prioritizeCritical: boolean;
  confirmed: true;
  authorizationReason: string;
  idempotencyKey: string;
  expectedAuditHead?: string;
};
export type StoredRun = RunInput & {
  runId: string;
  name: string;
  source: 'scenario' | 'import' | 'ai';
  aiTrace?: AgentTrace;
  policy: RiskPolicy;
  policyRevision: number;
  intentCount: number;
  createdAt: string;
  risk: RiskResult;
  commitments: Record<string, string>;
  auditHead: string | null;
  revision: number;
  auditEvents: HashAuditEvent[];
};
export type ReleaseResult = {
  runId: string;
  releasedIntentIds: string[];
  releasedCount: number;
  remainingHeld: number;
  auditHead: string;
  idempotentReplay: boolean;
};
export type ReplayResult = {
  runId: string;
  blocked: true;
  nonce: string;
  intentId: string;
  reason: string;
  fundsMoved: false;
  auditHead: string;
};

export function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('Expected a JSON object.');
  return value as Record<string, unknown>;
}

export function parseRunInput(value: unknown): RunInput {
  const input = parseObject(value);
  if (!scenarios.some((scenario) => scenario.id === input.scenarioId))
    throw new ApiError('Unknown scenario.');
  if (
    typeof input.severity !== 'number' ||
    !Number.isFinite(input.severity) ||
    input.severity < 0.1 ||
    input.severity > 1
  )
    throw new ApiError('Severity must be between 0.1 and 1.');
  if (
    typeof input.liquidityFloor !== 'number' ||
    !Number.isInteger(input.liquidityFloor) ||
    input.liquidityFloor < 50 ||
    input.liquidityFloor > 95
  )
    throw new ApiError('Liquidity floor must be an integer from 50 to 95.');
  return {
    scenarioId: input.scenarioId as ScenarioId,
    severity: input.severity,
    liquidityFloor: input.liquidityFloor,
  };
}

export function parseReleaseCount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10
  )
    throw new ApiError('Release count must be an integer from 1 to 10.');
  return value;
}

export function parseReleaseInput(
  value: unknown,
  headerKey?: string | null,
): ReleaseInput {
  const input = parseObject(value);
  const count = parseReleaseCount(input.count);
  const key = headerKey ?? input.idempotencyKey;
  if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{8,100}$/.test(key))
    throw new ApiError('A valid idempotency key is required.');
  if (
    headerKey &&
    input.idempotencyKey !== undefined &&
    headerKey !== input.idempotencyKey
  )
    throw new ApiError('Header and body idempotency keys must match.');
  if (input.confirmed !== true)
    throw new ApiError('Explicit human confirmation is required.');
  if (
    input.prioritizeCritical !== undefined &&
    typeof input.prioritizeCritical !== 'boolean'
  )
    throw new ApiError('prioritizeCritical must be a boolean.');
  const reason =
    typeof input.authorizationReason === 'string'
      ? input.authorizationReason.trim()
      : '';
  if (reason.length < 8 || reason.length > 160)
    throw new ApiError(
      'Authorization reason must contain 8 to 160 characters.',
    );
  if (
    input.expectedAuditHead !== undefined &&
    (typeof input.expectedAuditHead !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.expectedAuditHead))
  )
    throw new ApiError('Invalid expected audit head.');
  return {
    count,
    idempotencyKey: key,
    confirmed: true,
    authorizationReason: reason,
    prioritizeCritical: input.prioritizeCritical ?? true,
    ...(typeof input.expectedAuditHead === 'string'
      ? { expectedAuditHead: input.expectedAuditHead }
      : {}),
  };
}

export function validateRunId(value: string) {
  if (
    !/^RUN-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new ApiError('Invalid run identifier.');
}
