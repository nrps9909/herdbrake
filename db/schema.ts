import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const stressRuns = sqliteTable('stress_runs', {
  id: text('id').primaryKey(),
  scenarioId: text('scenario_id').notNull(),
  severity: real('severity').notNull(),
  liquidityFloor: integer('liquidity_floor').notNull(),
  state: text('state').notNull(),
  reasonCode: text('reason_code').notNull(),
  directionalAgreement: real('directional_agreement').notNull(),
  destinationConcentration: real('destination_concentration').notNull(),
  proposedOutflow: integer('proposed_outflow').notNull(),
  projectedBuffer: real('projected_buffer').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_stress_runs_created_at').on(table.createdAt)]);

export const paymentIntents = sqliteTable('payment_intents', {
  runId: text('run_id').notNull().references(() => stressRuns.id, { onDelete: 'cascade' }),
  intentId: text('intent_id').notNull(),
  entity: text('entity').notNull(),
  action: text('action').notNull(),
  destination: text('destination').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  individualPolicy: text('individual_policy').notNull(),
  status: text('status').notNull(),
  critical: integer('critical', { mode: 'boolean' }).notNull(),
  nonce: text('nonce').notNull(),
  commitment: text('commitment').notNull(),
  releasedAt: text('released_at'),
}, (table) => [
  primaryKey({ columns: [table.runId, table.intentId] }),
  uniqueIndex('idx_payment_intents_run_nonce').on(table.runId, table.nonce),
  index('idx_payment_intents_run_status').on(table.runId, table.status),
]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => stressRuns.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  detailJson: text('detail_json').notNull(),
  previousHash: text('previous_hash'),
  eventHash: text('event_hash').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_audit_events_run_created').on(table.runId, table.createdAt)]);

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').notNull(),
  runId: text('run_id').notNull().references(() => stressRuns.id, { onDelete: 'cascade' }),
  operation: text('operation').notNull(),
  responseJson: text('response_json').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.key] })]);
