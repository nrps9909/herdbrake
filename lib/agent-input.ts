import { ApiError } from './errors.ts';
import { parseCsv, previewImport } from './import-csv.ts';
import { parsePolicy } from './policy.ts';
import type { RiskPolicy } from './policy.ts';
import type { PaymentIntent } from './herdbrake.ts';

export type AgentInvoice = Pick<
  PaymentIntent,
  'id' | 'entity' | 'destination' | 'amount' | 'currency' | 'critical'
> & {
  description: string;
};
export type AgentInput = {
  invoices: AgentInvoice[];
  departmentBudgetUsd: number;
  policy: RiskPolicy;
};
export const agentCsvTemplate = `id,entity,destination,amount,currency,critical,description
INV-TPE-01,台北營運,PAYROLL-TPE,600000,USD,true,今天到期的本期薪資
INV-TPE-02,台北營運,SUPPLIER-A,800000,USD,false,已驗收發票；三日後到期
INV-HSC-01,新竹研發,PAYROLL-HSC,600000,USD,true,今天到期的本期薪資
INV-HSC-02,新竹研發,SUPPLIER-A,800000,USD,false,已驗收發票；今天到期
INV-TXG-01,台中供應鏈,PAYROLL-TXG,600000,USD,true,今天到期的本期薪資
INV-TXG-02,台中供應鏈,SUPPLIER-B,800000,USD,false,可延後一週且無違約金
`;
const encodeRow = (values: unknown[]) =>
  values.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',');

export function validateAgentInput(value: unknown): AgentInput {
  const fail = (message: string): never => {
    throw new ApiError(message, 422, 'HB_AI_INPUT');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('請提供發票資料。');
  const input = value as AgentInput;
  const policy = parsePolicy(input.policy);
  if (
    !Number.isFinite(input.departmentBudgetUsd) ||
    input.departmentBudgetUsd < 0.01 ||
    !/^\d+(\.\d{1,2})?$/.test(String(input.departmentBudgetUsd)) ||
    input.departmentBudgetUsd > 1_000_000_000 ||
    !Number.isSafeInteger(Math.round(input.departmentBudgetUsd * 100))
  )
    return fail('每個部門的預算需為 0.01 至 10 億美元，最多兩位小數。');
  if (
    !Array.isArray(input.invoices) ||
    !input.invoices.length ||
    input.invoices.length > 24
  )
    return fail('每次可規劃 1 至 24 張發票，最多 3 個部門，每部門最多 8 張。');
  const ids = new Set<string>();
  const units = new Map<string, number>();
  for (const invoice of input.invoices) {
    if (
      !invoice ||
      typeof invoice !== 'object' ||
      typeof invoice.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,48}$/.test(invoice.id) ||
      ids.has(invoice.id)
    )
      return fail('發票 ID 需唯一，限 1 至 48 個英數字、連字號或底線。');
    if (
      typeof invoice.description !== 'string' ||
      !invoice.description.trim() ||
      invoice.description.length > 240 ||
      Array.from(invoice.description).some((char) => char.charCodeAt(0) < 32)
    )
      return fail(
        '請為每張發票提供 1 至 240 字元的到期日或付款背景，勿包含控制字元。',
      );
    if (
      typeof invoice.amount !== 'number' ||
      typeof invoice.critical !== 'boolean' ||
      typeof invoice.entity !== 'string' ||
      typeof invoice.destination !== 'string'
    )
      return fail('發票金額、名稱或關鍵付款標記的格式錯誤。');
    ids.add(invoice.id);
    units.set(invoice.entity, (units.get(invoice.entity) ?? 0) + 1);
  }
  if (units.size > 3 || [...units.values()].some((n) => n > 8))
    return fail('最多 3 個部門，每部門最多 8 張發票；請將較大的清單分批。');
  const preview = previewImport(
    'entity,action,destination,amount,currency,critical\n' +
      input.invoices
        .map((invoice) =>
          encodeRow([
            invoice.entity,
            'PAY',
            invoice.destination,
            invoice.amount,
            invoice.currency,
            invoice.critical,
          ]),
        )
        .join('\n'),
    policy,
  );
  if (preview.issues.length)
    return fail(
      `發票 ${preview.issues[0].row - 1}：${preview.issues[0].message}`,
    );
  return {
    departmentBudgetUsd: input.departmentBudgetUsd,
    policy,
    invoices: input.invoices.map((invoice, index) => ({
      id: invoice.id,
      entity: preview.intents[index].entity,
      destination: preview.intents[index].destination,
      amount: preview.intents[index].amount,
      currency: preview.intents[index].currency,
      critical: invoice.critical,
      description: invoice.description.trim(),
    })),
  };
}

export function agentInputCsv(input: AgentInput) {
  return (
    'id,entity,destination,amount,currency,critical,description\n' +
    input.invoices
      .map((i) =>
        encodeRow([
          i.id,
          i.entity,
          i.destination,
          i.amount,
          i.currency,
          i.critical,
          i.description,
        ]),
      )
      .join('\n')
  );
}

export function parseAgentCsv(
  csv: string,
  policy: RiskPolicy,
  departmentBudgetUsd: number,
): AgentInput {
  const rows = parseCsv(csv);
  const fields = [
    'id',
    'entity',
    'destination',
    'amount',
    'currency',
    'critical',
    'description',
  ];
  const header = rows.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  if (
    header.length !== fields.length ||
    new Set(header).size !== fields.length ||
    fields.some((field) => !header.includes(field))
  )
    throw new ApiError(
      `AI 發票欄位必須包含 ${fields.join(', ')}，請使用 AI 專用範本。`,
    );
  return validateAgentInput({
    departmentBudgetUsd,
    policy,
    invoices: rows.map((row, index) => {
      if (row.length !== fields.length)
        throw new ApiError(`第 ${index + 2} 列欄位數量不符。`);
      const value = Object.fromEntries(
        header.map((key, i) => [key, row[i].trim()]),
      );
      if (
        !/^\d+(\.\d{1,2})?$/.test(value.amount) ||
        !['true', 'false', '1', '0'].includes(value.critical.toLowerCase())
      )
        throw new ApiError(
          `第 ${index + 2} 列：金額需為正數且最多兩位小數，critical 需為 true 或 false。`,
        );
      return {
        ...value,
        amount: Number(value.amount),
        critical: ['true', '1'].includes(value.critical.toLowerCase()),
        currency: value.currency.toUpperCase(),
      };
    }),
  });
}
