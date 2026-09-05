import { ApiError } from './errors.ts';
import type { PaymentIntent } from './herdbrake.ts';
import { sha256Hex, stableStringify } from './assurance-core.ts';

export type AgentDecision = {
  invoiceId: string;
  action: 'PAY' | 'DELAY';
  reason: string;
};
export type AgentSession = {
  agent: string;
  prompt: string;
  decisions: AgentDecision[];
  response: string;
  model: string;
  completedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};
export type AgentTrace = {
  version: 1;
  mode: 'live' | 'recorded';
  provider: 'ollama';
  scenario: 'shared-deadline';
  recordedAt: string;
  sessions: AgentSession[];
  contentHash: string;
};
export const agentUnits = ['台北營運', '新竹研發', '台中供應鏈'] as const;
export const agentInvoices = agentUnits.flatMap((entity, unit) =>
  Array.from({ length: 4 }, (_, item) => ({
    id: `AI-${unit + 1}-${item + 1}`,
    entity,
    destination: item === 0 ? `PAYROLL-${unit + 1}` : 'SUPPLIER-HUB',
    amount: 900_000,
    currency: 'USD' as const,
    critical: item === 0,
    description:
      item === 0
        ? '本期薪資，今天到期'
        : '已驗收供應商發票，今天到期，延誤將產生違約金',
  })),
);
export function agentPrompt(agent: string) {
  return `你是${agent}的財務 AI 代理。以下都是合成資料。今天所有部門收到同一個付款截止訊號。你只能看見本部門資料，不能假設看見其他部門。
本部門今天可用預算為 4,000,000 USD，單筆上限 1,000,000 USD。請在不超過本部門預算的前提下，決定每張發票今天 PAY 或 DELAY，考慮到期日、營運連續性和延遲成本。你無權實際付款。理由用一句繁體中文，不超過 80 字。
發票：${JSON.stringify(agentInvoices.filter((i) => i.entity === agent))}
只回傳 JSON：{"decisions":[{"invoiceId":"發票 ID","action":"PAY 或 DELAY","reason":"業務理由"}]}。每張發票必須且只能出現一次。`;
}
export const agentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['invoiceId', 'action', 'reason'],
        properties: {
          invoiceId: { type: 'string' },
          action: { type: 'string', enum: ['PAY', 'DELAY'] },
          reason: { type: 'string' },
        },
      },
    },
  },
};
export function parseAgentDecisions(
  value: unknown,
  agent: string,
): AgentDecision[] {
  const fail = () => {
    throw new ApiError(
      'AI 回傳的發票或動作不符合限制；未建立批次。',
      502,
      'HB_AI_INVALID',
    );
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).join(',') !== 'decisions'
  )
    return fail();
  const decisions = (value as { decisions?: unknown }).decisions;
  const allowed = new Set(
    agentInvoices.filter((i) => i.entity === agent).map((i) => i.id),
  );
  if (
    !allowed.size ||
    !Array.isArray(decisions) ||
    decisions.length !== allowed.size
  )
    return fail();
  return decisions.map((d: unknown) => {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return fail();
    const item = d as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(',') !== 'action,invoiceId,reason' ||
      typeof item.invoiceId !== 'string' ||
      !allowed.delete(item.invoiceId) ||
      typeof item.action !== 'string' ||
      !['PAY', 'DELAY'].includes(item.action) ||
      typeof item.reason !== 'string' ||
      !item.reason.trim() ||
      item.reason.length > 240
    )
      return fail();
    return {
      invoiceId: item.invoiceId,
      action: item.action as 'PAY' | 'DELAY',
      reason: item.reason.trim(),
    };
  });
}
export function agentIntents(trace: AgentTrace): PaymentIntent[] {
  if (
    trace.sessions.length !== 3 ||
    new Set(trace.sessions.map((s) => s.agent)).size !== 3
  )
    throw new ApiError('AI 紀錄不完整。', 502, 'HB_AI_INVALID');
  return trace.sessions.flatMap((session) =>
    parseAgentDecisions({ decisions: session.decisions }, session.agent).map(
      (decision) => {
        const invoice = agentInvoices.find((i) => i.id === decision.invoiceId)!;
        return {
          id: invoice.id,
          entity: invoice.entity,
          destination: invoice.destination,
          amount: invoice.amount,
          currency: invoice.currency,
          critical: invoice.critical,
          action: decision.action,
          individualPolicy: 'PASS' as const,
          status: 'HELD' as const,
          nonce: `AGENT-${invoice.id}`,
        };
      },
    ),
  );
}
export async function traceHash(
  trace: Omit<AgentTrace, 'contentHash'> | AgentTrace,
) {
  // Playback changes delivery mode only; the original inference content stays identical.
  return sha256Hex(
    stableStringify({
      version: trace.version,
      provider: trace.provider,
      scenario: trace.scenario,
      recordedAt: trace.recordedAt,
      sessions: trace.sessions,
    }),
  );
}
export async function verifyAgentTrace(trace: AgentTrace) {
  return (
    trace.version === 1 &&
    trace.provider === 'ollama' &&
    trace.scenario === 'shared-deadline' &&
    (await traceHash(trace)) === trace.contentHash
  );
}
export async function generateAgentTrace(
  baseUrl: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentTrace> {
  // Server configuration only. No browser-supplied URLs, prompts, models, or invoices.
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ApiError('AI 服務設定錯誤。', 503, 'HB_AI_UNAVAILABLE');
  const sessions: AgentSession[] = [];
  for (const agent of agentUnits) {
    const prompt = agentPrompt(agent);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetcher(new URL('/api/chat', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          format: agentSchema,
          stream: false,
          think: false,
          options: { temperature: 0, num_predict: 1200, num_ctx: 4096 },
        }),
      });
    } catch {
      throw new ApiError(
        'AI 服務未連線或已逾時；未建立批次。請確認 Ollama 已啟動。',
        503,
        'HB_AI_UNAVAILABLE',
      );
    }
    if (!response.ok)
      throw new ApiError(
        'AI 服務未完成推論；未建立批次。',
        502,
        'HB_AI_UPSTREAM',
      );
    const raw = await response.text();
    if (raw.length > 65_536)
      throw new ApiError('AI 回應過大。', 502, 'HB_AI_INVALID');
    try {
      const body = JSON.parse(raw);
      if (
        body.done !== true ||
        body.done_reason === 'length' ||
        typeof body.message?.content !== 'string' ||
        typeof body.model !== 'string'
      )
        throw new Error('incomplete');
      const decisions = parseAgentDecisions(
        JSON.parse(body.message.content),
        agent,
      );
      sessions.push({
        agent,
        prompt,
        decisions,
        response: body.message.content,
        model: body.model,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        inputTokens: Number.isSafeInteger(body.prompt_eval_count)
          ? body.prompt_eval_count
          : 0,
        outputTokens: Number.isSafeInteger(body.eval_count)
          ? body.eval_count
          : 0,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'AI 回傳格式不完整；未建立批次。',
        502,
        'HB_AI_INVALID',
      );
    }
  }
  const trace: AgentTrace = {
    version: 1,
    mode: 'live',
    provider: 'ollama',
    scenario: 'shared-deadline',
    recordedAt: new Date().toISOString(),
    sessions,
    contentHash: '',
  };
  trace.contentHash = await traceHash(trace);
  return trace;
}
