import { env } from 'cloudflare:workers';
import recording from '@/fixtures/agent-recording.json';
import { generateAgentTrace } from '@/lib/agent-workflow';
import type { AgentTrace } from '@/lib/agent-workflow';
import { requireApiUser } from '@/lib/server/access';
import { assuranceStore } from '@/lib/server/assurance-store';
import { createWorkspaceRepository } from '@/lib/server/workspace-repository';
import { getDatabase } from '@/lib/server/db';
import { apiHandler, json, readJson } from '@/lib/server/http';
import { parseObject, validateRunId } from '@/lib/contracts';
import { ApiError, ConflictError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
const configuration = () =>
  env as unknown as { OLLAMA_BASE_URL?: string; OLLAMA_MODEL?: string };
export function GET(request: Request) {
  return apiHandler(async () => {
    await requireApiUser(request);
    const config = configuration();
    return json({
      liveAvailable: Boolean(config.OLLAMA_BASE_URL),
      model: config.OLLAMA_MODEL || 'qwen3.5:4b',
      recordingModel: recording.sessions[0].model,
      recordedAt: recording.recordedAt,
    });
  }, '無法讀取 AI 模型狀態。');
}
export function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const body = parseObject(await readJson(request));
    if (
      typeof body.mode !== 'string' ||
      !['live', 'recorded'].includes(body.mode) ||
      !Number.isSafeInteger(body.policyRevision) ||
      typeof body.requestId !== 'string'
    )
      throw new ApiError('請選擇推論模式並重新載入政策。');
    validateRunId(`RUN-${body.requestId}`);
    const repository = assuranceStore(user.userId);
    const existing = await repository.getStoredRun(`RUN-${body.requestId}`);
    if (existing) {
      if (
        existing.source !== 'ai' ||
        existing.aiTrace?.mode !== body.mode ||
        existing.policyRevision !== body.policyRevision
      )
        throw new ConflictError('請求識別碼已用於其他提案。');
      return json(existing);
    }
    const settings = await createWorkspaceRepository(
      getDatabase(),
      user.userId,
    ).getSettings();
    if (settings.revision !== body.policyRevision)
      throw new ConflictError('政策已更新，請重新載入後再執行。');
    const config = configuration();
    if (body.mode === 'live' && !config.OLLAMA_BASE_URL)
      throw new ApiError(
        '此環境未啟用即時模型。可以重現已錄製的真實推論，或依 README 啟動本機 Ollama。',
        503,
        'HB_AI_UNAVAILABLE',
      );
    if (body.mode === 'live')
      await createWorkspaceRepository(
        getDatabase(),
        `ai:${user.userId}`,
      ).consumeMutationLimit(3);
    const trace =
      body.mode === 'live'
        ? await generateAgentTrace(
            config.OLLAMA_BASE_URL!,
            config.OLLAMA_MODEL || 'qwen3.5:4b',
          )
        : ({ ...recording, mode: 'recorded' } as AgentTrace);
    const saved = await repository.createAgentRun(
      trace,
      body.policyRevision as number,
      body.requestId,
    );
    return json(saved, { status: 201 });
  }, 'AI 工作流程未完成；請重新載入查看是否已建立批次。');
}
