import type { AgentAction, PaymentIntent } from './herdbrake.ts';
import { amountInUsd } from './herdbrake.ts';
import type { RiskPolicy } from './policy.ts';
import { ApiError } from './errors.ts';

export const csvTemplate =
  'entity,action,destination,amount,currency,critical\nTaipei HQ,PAY,SUPPLIER-001,125000,TWD,true\nHsinchu R&D,TRANSFER,RESERVE-001,8500,USD,false\nTaichung Ops,PAY,SUPPLIER-002,4200,USD,true\n';
export type ImportIssue = { row: number; field: string; message: string };
export type ImportPreview = {
  intents: PaymentIntent[];
  issues: ImportIssue[];
  rowCount: number;
};

// RFC 4180-style quoting, embedded commas/newlines, CRLF and UTF-8 BOM.
export function parseCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > 32_768)
    throw new ApiError('CSV 檔案上限為 32 KB。');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === '"') {
      if (cell || closed) throw new ApiError('CSV 引號格式錯誤。');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (char !== ',') {
        if (row.some((item) => item.trim())) rows.push(row);
        row = [];
        if (char === '\r' && input[i + 1] === '\n') i++;
      }
    } else {
      if (closed && char.trim())
        throw new ApiError('CSV 關閉引號後只能接分隔符號。');
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new ApiError('CSV 有未關閉的引號。');
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}
export function previewImport(csv: string, policy: RiskPolicy): ImportPreview {
  const rows = parseCsv(csv);
  const expected = [
    'entity',
    'action',
    'destination',
    'amount',
    'currency',
    'critical',
  ];
  const header = rows.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  if (
    header.length !== expected.length ||
    new Set(header).size !== header.length ||
    expected.some((key) => !header.includes(key))
  )
    throw new ApiError(
      `CSV 欄位必須包含：${expected.join(', ')}。請下載範本。`,
    );
  if (!rows.length || rows.length > 50)
    throw new ApiError('每批請匯入 1 至 50 筆付款意圖。');
  const issues: ImportIssue[] = [];
  const intents: PaymentIntent[] = [];
  rows.forEach((row, index) => {
    const start = issues.length;
    const fail = (field: string, message: string) =>
      issues.push({ row: index + 2, field, message });
    if (row.length !== header.length) {
      fail('row', '欄位數量與標題不符');
      return;
    }
    const value = Object.fromEntries(
      header.map((key, i) => [key, row[i].trim()]),
    );
    for (const key of ['entity', 'destination'])
      if (
        !value[key] ||
        value[key].length > 100 ||
        Array.from(value[key]).some((char) => char.charCodeAt(0) < 32)
      )
        fail(key, '請填入 1 至 100 字元的名稱');
    const action = value.action.toUpperCase();
    const currency = value.currency.toUpperCase();
    if (!['PAY', 'DELAY', 'BUFFER', 'TRANSFER', 'USDC'].includes(action))
      fail('action', '僅接受 PAY / DELAY / BUFFER / TRANSFER / USDC');
    if (!['TWD', 'USD', 'USDC'].includes(currency))
      fail('currency', '僅接受 TWD / USD / USDC');
    const amount = Number(value.amount);
    if (
      !/^\d+(\.\d{1,2})?$/.test(value.amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(Math.round(amount * 100))
    )
      fail('amount', '請填入正數，最多兩位小數');
    if (!['true', 'false', '1', '0'].includes(value.critical.toLowerCase()))
      fail('critical', '請填入 true 或 false');
    if (start !== issues.length) return;
    const intent: PaymentIntent = {
      id: `INT-CSV-${String(index + 1).padStart(3, '0')}`,
      entity: value.entity,
      action: action as AgentAction,
      destination: value.destination,
      amount,
      currency: currency as PaymentIntent['currency'],
      critical: ['true', '1'].includes(value.critical.toLowerCase()),
      individualPolicy: 'PASS',
      status: 'HELD',
      nonce: `IMPORT-${index + 1}`,
    };
    if (amountInUsd(intent, policy) > policy.maxIntentUsd) {
      fail(
        'amount',
        `超過單筆政策上限 US$${policy.maxIntentUsd.toLocaleString('en-US')}`,
      );
      return;
    }
    intents.push(intent);
  });
  return { intents, issues, rowCount: rows.length };
}
export function intentsCsv(intents: PaymentIntent[]) {
  const escape = (value: unknown) => {
    const text = String(value);
    // Prevent spreadsheet formula injection in downloaded user-supplied cells.
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      [
        'id',
        'entity',
        'action',
        'destination',
        'amount',
        'currency',
        'critical',
        'status',
      ],
      ...intents.map((item) => [
        item.id,
        item.entity,
        item.action,
        item.destination,
        item.amount,
        item.currency,
        item.critical,
        item.status,
      ]),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\r\n')
  );
}
