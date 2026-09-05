'use client';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, assuranceApi } from '@/lib/client-api';
import type { ReleaseInput, RunInput, StoredRun } from '@/lib/contracts';
import type { RiskPolicy, WorkspaceSettings } from '@/lib/policy';
import type { RunList } from '@/lib/workspace-types';
import { ApiError } from '@/lib/errors';
export type WorkspaceData = {
  settings: WorkspaceSettings;
  history: Array<{ revision: number; policy: RiskPolicy; createdAt: string }>;
};
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '連線失敗，請稍後重試。';
export function useWorkspace(selectedId: string | null) {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [list, setList] = useState<RunList | null>(null);
  const [run, setRun] = useState<StoredRun | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const loadKey = JSON.stringify([selectedId, refreshToken]);
  const loading = loadedKey !== loadKey;
  const operation = useRef(false);
  const generation = useRef(0);
  const pending = useRef<{ signature: string; input: ReleaseInput } | null>(
    null,
  );
  const agentPending = useRef<{ signature: string; requestId: string } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    void Promise.allSettled([
      apiRequest<WorkspaceData>('/api/workspace', {
        signal: controller.signal,
      }),
      apiRequest<RunList>('/api/runs?list=1', { signal: controller.signal }),
      apiRequest<StoredRun | null>(
        selectedId
          ? `/api/runs/${encodeURIComponent(selectedId)}`
          : '/api/runs',
        { signal: controller.signal },
      ),
    ])
      .then(([nextWorkspace, nextList, nextRun]) => {
        if (controller.signal.aborted || version !== generation.current) return;
        if (nextWorkspace.status === 'rejected') throw nextWorkspace.reason;
        if (nextList.status === 'rejected') throw nextList.reason;
        setWorkspace(nextWorkspace.value);
        setList(nextList.value);
        if (nextRun.status === 'fulfilled') setRun(nextRun.value);
        else {
          // An absent bookmarked run must not make settings, history or importing inaccessible.
          setRun(null);
          setNotice({ message: errorText(nextRun.reason), error: true });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && version === generation.current) {
          setRun(null);
          setNotice({ message: errorText(error), error: true });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && version === generation.current)
          setLoadedKey(loadKey);
      });
    return () => controller.abort();
  }, [selectedId, loadKey]);
  const refresh = () => setRefreshToken((value) => value + 1);
  const perform = async <T>(
    action: () => Promise<T>,
    success: string,
  ): Promise<T> => {
    if (operation.current) throw new Error('上一項操作仍在處理中。');
    operation.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ message: success, error: false });
      return result;
    } catch (error) {
      setNotice({ message: errorText(error), error: true });
      throw error;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const syncList = async () => {
    setList(await apiRequest<RunList>('/api/runs?list=1'));
  };
  const create = async (input: RunInput) =>
    perform(async () => {
      const saved = await assuranceApi.create(input);
      setRun(saved);
      pending.current = null;
      // A secondary list read must not turn a confirmed save into a duplicate submission.
      try {
        await syncList();
      } catch {
        refresh();
      }
      return saved;
    }, '情境測試已儲存，可以開始審查付款意圖。');
  const importRun = async (input: {
    name: string;
    csv: string;
    policyRevision: number;
  }) =>
    perform(async () => {
      const saved = await apiRequest<StoredRun>('/api/runs/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      setRun(saved);
      pending.current = null;
      try {
        await syncList();
      } catch {
        refresh();
      }
      return saved;
    }, '批次已匯入，風險結果與原始資料均已儲存。');
  const runAgents = (mode: 'live' | 'recorded') =>
    perform(async () => {
      if (!workspace) throw new Error('請等候政策載入。');
      const signature = `${mode}:${workspace.settings.revision}`;
      if (agentPending.current?.signature !== signature)
        agentPending.current = { signature, requestId: crypto.randomUUID() };
      const saved = await apiRequest<StoredRun>(
        '/api/agents',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode,
            policyRevision: workspace.settings.revision,
            requestId: agentPending.current.requestId,
          }),
        },
        200_000,
      );
      agentPending.current = null;
      pending.current = null;
      setRun(saved);
      try {
        await syncList();
      } catch {
        refresh();
      }
      return saved;
    }, 'AI 提案已儲存，聚合風險已計算；所有付款仍需人工核准。');
  const release = async (
    values: Omit<ReleaseInput, 'idempotencyKey' | 'expectedAuditHead'>,
  ) => {
    if (!run) throw new Error('請先開啟一筆批次。');
    const current = run;
    const signature = JSON.stringify({ runId: current.runId, ...values });
    if (pending.current?.signature !== signature)
      pending.current = {
        signature,
        input: {
          ...values,
          expectedAuditHead: current.auditHead!,
          idempotencyKey: `release:${crypto.randomUUID()}`,
        },
      };
    return perform(async () => {
      try {
        const result = await assuranceApi.release(
          current.runId,
          pending.current!.input,
        );
        const updated = await assuranceApi.get(current.runId);
        setRun(updated);
        pending.current = null;
        try {
          await syncList();
        } catch {
          refresh();
        }
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          pending.current = null;
          if (error.status === 409) refresh();
        }
        throw error;
      }
    }, '審核已記錄，付款意圖狀態已更新。');
  };
  const replay = () =>
    perform(async () => {
      if (!run) throw new Error('請先開啟一筆批次。');
      const result = await assuranceApi.replay(run.runId);
      setRun(await assuranceApi.get(run.runId));
      return result;
    }, '重播檢查完成，重複的付款識別碼已被拒絕。');
  const saveSettings = (settings: WorkspaceSettings) =>
    perform(async () => {
      const saved = await apiRequest<WorkspaceSettings>('/api/workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setWorkspace((current) => ({
        settings: saved,
        history: [
          {
            revision: saved.revision,
            policy: saved.policy,
            createdAt: saved.updatedAt,
          },
          ...(current?.history ?? []),
        ].slice(0, 20),
      }));
      return saved;
    }, '工作區政策已儲存；新批次將採用此版本。');
  return {
    workspace,
    list,
    run,
    loading,
    busy,
    notice,
    setNotice,
    refresh,
    create,
    runAgents,
    importRun,
    release,
    replay,
    saveSettings,
  };
}
