import { defaultPolicy } from './policy.ts';
import type { RiskPolicy } from './policy.ts';

export type ScenarioId =
  | 'stablecoin'
  | 'fx'
  | 'settlement'
  | 'supplier'
  | 'receivables'
  | 'shared-feed';
export type AgentAction = 'PAY' | 'DELAY' | 'BUFFER' | 'TRANSFER' | 'USDC';
export type IntentStatus = 'HELD' | 'READY' | 'RELEASED' | 'BLOCKED';

export type Scenario = {
  id: ScenarioId;
  name: string;
  shortName: string;
  description: string;
  commonSignal: string;
  icon: string;
};

export type PaymentIntent = {
  id: string;
  entity: string;
  action: AgentAction;
  destination: string;
  amount: number;
  currency: 'USD' | 'TWD' | 'USDC';
  individualPolicy: 'PASS';
  status: IntentStatus;
  critical: boolean;
  nonce: string;
};

export type RiskResult = {
  intents: PaymentIntent[];
  directionalAgreement: number;
  destinationConcentration: number;
  proposedOutflow: number;
  projectedBuffer: number;
  liquidityFloor: number;
  leadingAction: AgentAction;
  leadingCount: number;
  state: 'NORMAL' | 'REVIEW' | 'CRITICAL';
  reasonCode: string;
};

export const scenarios: Scenario[] = [
  {
    id: 'stablecoin',
    name: 'Stablecoin depeg response',
    shortName: '穩定幣脫鉤',
    description: 'USDC 短暫偏離美元，財務代理同步轉移至 reserve wallet。',
    commonSignal: 'USDC/TWD liquidity feed',
    icon: 'USDC',
  },
  {
    id: 'fx',
    name: 'FX rate spike',
    shortName: '美元急升',
    description: '美元兌新台幣急升，agents 同時提前購匯並延後付款。',
    commonSignal: 'USD/TWD spot feed',
    icon: 'FX',
  },
  {
    id: 'settlement',
    name: 'Bank settlement delay',
    shortName: '結算延遲',
    description: '主要往來銀行延遲結算，多個法人同步提高現金 buffer。',
    commonSignal: 'Bank settlement status',
    icon: 'T+1',
  },
  {
    id: 'supplier',
    name: 'Supplier destination anomaly',
    shortName: '供應商異常',
    description: '主要供應商變更收款目的地，觸發集中付款與驗證需求。',
    commonSignal: 'Supplier master update',
    icon: 'AP',
  },
  {
    id: 'receivables',
    name: 'Receivables slowdown',
    shortName: '收款延遲',
    description: '大量客戶延遲付款，部門 agents 同步延後非必要支出。',
    commonSignal: 'ERP aging report',
    icon: 'AR',
  },
  {
    id: 'shared-feed',
    name: 'Corrupted shared signal',
    shortName: '共用訊號錯誤',
    description: '共用風險資料源誤報，造成跨模型 agents 同步採取防禦行動。',
    commonSignal: 'Vendor risk API',
    icon: 'API',
  },
];

// Fixed synthetic conversion; never a live quote or settlement price.
export const SIMULATED_TWD_PER_USD = 32;
export function amountInUsd(
  intent: Pick<PaymentIntent, 'amount' | 'currency'>,
  policy: RiskPolicy = defaultPolicy,
) {
  return intent.currency === 'TWD'
    ? intent.amount / policy.twdPerUsd
    : intent.currency === 'USDC'
      ? intent.amount * policy.usdcUsd
      : intent.amount;
}

const baseAmounts = [270, 340, 180, 420, 225, 315, 290, 385, 205, 360];
const entities = [
  'Taipei HQ',
  'Taichung Ops',
  'Kaohsiung Trade',
  'Hsinchu R&D',
  'Tainan Supply',
];

export function runRiskEngine({
  scenarioId,
  severity,
  liquidityFloor = 75,
  agentCount = 30,
  releasedIds = [],
}: {
  scenarioId: ScenarioId;
  severity: number;
  liquidityFloor?: number;
  agentCount?: number;
  releasedIds?: string[];
}): RiskResult {
  const herdCount = Math.max(
    7,
    Math.min(agentCount - 2, Math.round(agentCount * (0.42 + severity * 0.4))),
  );
  const secondaryCount = Math.min(
    agentCount - herdCount,
    Math.max(2, Math.round(agentCount * severity * 0.14)),
  );
  const leadingAction: AgentAction =
    scenarioId === 'settlement' || scenarioId === 'receivables'
      ? 'BUFFER'
      : scenarioId === 'fx'
        ? 'DELAY'
        : 'TRANSFER';
  const secondaryAction: AgentAction =
    scenarioId === 'stablecoin' ? 'USDC' : 'DELAY';
  const herdDestination =
    scenarioId === 'supplier'
      ? 'SUPPLIER-NEW-09'
      : scenarioId === 'stablecoin'
        ? 'RESERVE-USDC-01'
        : 'GROUP-RESERVE-01';

  const intents = Array.from(
    { length: agentCount },
    (_, index): PaymentIntent => {
      const id = `INT-TW-${String(index + 1).padStart(3, '0')}`;
      const action: AgentAction =
        index < herdCount
          ? leadingAction
          : index < herdCount + secondaryCount
            ? secondaryAction
            : (['PAY', 'DELAY', 'BUFFER'] as AgentAction[])[index % 3];
      const destination =
        index < herdCount
          ? herdDestination
          : `VENDOR-${String((index % 11) + 1).padStart(2, '0')}`;
      const amount =
        (baseAmounts[index % baseAmounts.length] + (index % 4) * 15) * 1000;
      return {
        id,
        entity: entities[index % entities.length],
        action,
        destination,
        amount:
          action !== 'USDC' && index % 4 === 0
            ? amount * SIMULATED_TWD_PER_USD
            : amount,
        currency: action === 'USDC' ? 'USDC' : index % 4 === 0 ? 'TWD' : 'USD',
        individualPolicy: 'PASS',
        status: releasedIds.includes(id) ? 'RELEASED' : 'HELD',
        critical: index % 6 === 0,
        nonce: `0xHB${String(4200 + index).padStart(6, '0')}`,
      };
    },
  );

  return evaluateRisk(intents, liquidityFloor);
}

// Recompute from the durable intentions, never regenerate stored payment data.
// Metrics describe the complete authorized batch, including already released items.
export function evaluateRisk(
  intents: PaymentIntent[],
  liquidityFloor: number,
  policy: RiskPolicy = defaultPolicy,
): RiskResult {
  const agentCount = intents.length;
  const actionCounts = intents.reduce<Record<AgentAction, number>>(
    (acc, intent) => {
      acc[intent.action] += 1;
      return acc;
    },
    { PAY: 0, DELAY: 0, BUFFER: 0, TRANSFER: 0, USDC: 0 },
  );
  const leadingAction = (Object.keys(actionCounts) as AgentAction[]).reduce(
    (best, action) =>
      actionCounts[action] > actionCounts[best] ? action : best,
    'PAY',
  );
  const destinationCounts = new Map<string, number>();
  for (const intent of intents)
    destinationCounts.set(
      intent.destination,
      (destinationCounts.get(intent.destination) ?? 0) + 1,
    );
  const proposedOutflow = intents
    .filter((intent) => intent.action !== 'DELAY' && intent.action !== 'BUFFER')
    .reduce((sum, intent) => sum + amountInUsd(intent, policy), 0);
  const openingLiquidity = policy.openingLiquidity;
  const projectedBuffer = Math.max(
    0,
    ((openingLiquidity - proposedOutflow) / openingLiquidity) * 100,
  );
  const directionalAgreement =
    (Math.max(0, ...Object.values(actionCounts)) / (agentCount || 1)) * 100;
  const destinationConcentration =
    (Math.max(0, ...destinationCounts.values()) / (agentCount || 1)) * 100;
  const critical =
    projectedBuffer < liquidityFloor ||
    directionalAgreement >= policy.herdThreshold;
  const review =
    directionalAgreement >= 55 ||
    destinationConcentration >= policy.concentrationThreshold;

  return {
    intents,
    directionalAgreement,
    destinationConcentration,
    proposedOutflow,
    projectedBuffer,
    liquidityFloor,
    leadingAction,
    leadingCount: actionCounts[leadingAction],
    state: critical ? 'CRITICAL' : review ? 'REVIEW' : 'NORMAL',
    reasonCode: critical
      ? projectedBuffer < liquidityFloor
        ? 'HB-LIQ-003'
        : 'HB-HERD-002'
      : review
        ? 'HB-CONC-001'
        : 'HB-OK-001',
  };
}

export function formatMoney(
  value: number,
  currency: PaymentIntent['currency'] = 'USD',
) {
  const prefix =
    currency === 'TWD' ? 'NT$' : currency === 'USDC' ? 'USDC ' : 'US$';
  return value >= 1_000_000
    ? `${prefix}${(value / 1_000_000).toFixed(1)}M`
    : `${prefix}${Math.round(value / 1000)}K`;
}

export function formatPct(value: number) {
  return `${Math.round(value)}%`;
}

export function selectSafeRelease(
  intents: PaymentIntent[],
  count: number,
  policy: RiskPolicy = defaultPolicy,
) {
  return intents
    .filter((intent) => intent.status === 'HELD')
    .sort(
      (a, b) =>
        Number(b.critical) - Number(a.critical) ||
        amountInUsd(a, policy) - amountInUsd(b, policy),
    )
    .slice(0, count)
    .map((intent) => intent.id);
}
