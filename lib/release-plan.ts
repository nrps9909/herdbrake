import { amountInUsd, selectSafeRelease } from './herdbrake.ts';
import type { PaymentIntent } from './herdbrake.ts';
import type { RiskPolicy } from './policy.ts';

function decimalRatio(value: number): [bigint, bigint] {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Invalid monetary value.');
  const [coefficient, exponent = '0'] = value
    .toString()
    .toLowerCase()
    .split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const scale = fraction.length - Number(exponent);
  const digits = BigInt(whole + fraction);
  return scale >= 0
    ? [digits, 10n ** BigInt(scale)]
    : [digits * 10n ** BigInt(-scale), 1n];
}

// Reserve in USD cents, rounding each converted outflow upward. DELAY and
// BUFFER are decisions to retain cash, so approving them consumes no budget.
export function outflowCents(intent: PaymentIntent, policy: RiskPolicy) {
  if (intent.action === 'DELAY' || intent.action === 'BUFFER') return 0;
  let [numerator, denominator] = decimalRatio(intent.amount);
  if (intent.currency === 'TWD') {
    const [rateN, rateD] = decimalRatio(policy.twdPerUsd);
    numerator *= rateD;
    denominator *= rateN;
  } else if (intent.currency === 'USDC') {
    const [rateN, rateD] = decimalRatio(policy.usdcUsd);
    numerator *= rateN;
    denominator *= rateD;
  }
  return Number((numerator * 100n + denominator - 1n) / denominator);
}

export function releasePosition(intents: PaymentIntent[], policy: RiskPolicy) {
  const [openingN, openingD] = decimalRatio(policy.openingLiquidity);
  const openingCents = Number((openingN * 100n) / openingD);
  const budgetCents = Math.floor(
    (openingCents * (100 - policy.liquidityFloor)) / 100,
  );
  const approvedCents = intents
    .filter((intent) => intent.status === 'RELEASED')
    .reduce((sum, intent) => sum + outflowCents(intent, policy), 0);
  return {
    openingCents,
    budgetCents,
    approvedCents,
    approvedOutflow: approvedCents / 100,
    remainingBudget: Math.max(0, budgetCents - approvedCents) / 100,
    retainedBuffer: ((openingCents - approvedCents) / openingCents) * 100,
    withinFloor: approvedCents <= budgetCents,
  };
}

// Client preview and server enforcement share exactly the same ordering and
// arithmetic. All-or-nothing approval never silently changes the reviewed IDs.
export function planRelease(
  intents: PaymentIntent[],
  count: number,
  prioritizeCritical: boolean,
  policy: RiskPolicy,
  selectedIds?: string[],
  departmentBudgetUsd?: number,
) {
  const held = intents.filter((intent) => intent.status === 'HELD');
  const invalidSelection = Boolean(
    selectedIds &&
    (new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !held.some((intent) => intent.id === id))),
  );
  const ids =
    selectedIds ??
    (prioritizeCritical
      ? selectSafeRelease(intents, count, policy)
      : held.slice(0, count).map((intent) => intent.id));
  const candidates = ids
    .map((id) => held.find((intent) => intent.id === id))
    .filter((intent) => intent !== undefined);
  const position = releasePosition(intents, policy);
  const outflow = candidates.reduce(
    (sum, intent) => sum + outflowCents(intent, policy),
    0,
  );
  const afterCents = position.approvedCents + outflow;
  const overLimitIds = candidates
    .filter((intent) => amountInUsd(intent, policy) > policy.maxIntentUsd)
    .map((intent) => intent.id);
  const withinFloor = afterCents <= position.budgetCents;
  const departmentChecks =
    departmentBudgetUsd === undefined
      ? []
      : departmentReleaseChecks(intents, ids, policy, departmentBudgetUsd);
  return {
    invalidSelection,
    ids,
    candidates,
    approvedOutflow: position.approvedOutflow,
    batchOutflow: outflow / 100,
    remainingBudget: Math.max(0, position.budgetCents - afterCents) / 100,
    projectedBuffer:
      ((position.openingCents - afterCents) / position.openingCents) * 100,
    shortfall: Math.max(0, afterCents - position.budgetCents) / 100,
    overLimitIds,
    withinFloor,
    departmentChecks,
    allowed:
      !invalidSelection &&
      ids.length > 0 &&
      withinFloor &&
      !overLimitIds.length &&
      departmentChecks.every((check) => check.withinBudget),
  };
}

export function suggestRelease(
  intents: PaymentIntent[],
  policy: RiskPolicy,
  departmentBudgetUsd?: number,
) {
  const position = releasePosition(intents, policy);
  let remaining = position.budgetCents - position.approvedCents;
  const result: string[] = [];
  for (const id of selectSafeRelease(intents, intents.length, policy)) {
    const intent = intents.find((item) => item.id === id)!;
    const amount = outflowCents(intent, policy);
    if (
      result.length < 10 &&
      amount <= remaining &&
      amountInUsd(intent, policy) <= policy.maxIntentUsd &&
      (departmentBudgetUsd === undefined ||
        departmentReleaseChecks(
          intents,
          [...result, id],
          policy,
          departmentBudgetUsd,
        ).every((check) => check.withinBudget))
    ) {
      result.push(id);
      remaining -= amount;
    }
  }
  return result;
}

export function departmentReleaseChecks(
  intents: PaymentIntent[],
  selectedIds: string[],
  policy: RiskPolicy,
  budgetUsd: number,
) {
  const totals = new Map<string, number>();
  for (const intent of intents) {
    const previous = totals.get(intent.entity) ?? 0;
    totals.set(
      intent.entity,
      previous +
        (intent.status === 'RELEASED' || selectedIds.includes(intent.id)
          ? outflowCents(intent, policy)
          : 0),
    );
  }
  const [budgetN, budgetD] = decimalRatio(budgetUsd);
  const budgetCents = Number((budgetN * 100n) / budgetD);
  return [...totals].map(([entity, cents]) => ({
    entity,
    approvedOutflow: cents / 100,
    budget: budgetCents / 100,
    withinBudget: cents <= budgetCents,
  }));
}
