'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Play,
  History,
  ArrowRight,
  ShieldCheck,
  Download,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StoredRun } from '@/lib/contracts';
import { apiRequest } from '@/lib/client-api';
import { SectionTitle, StatusBadge, money, saveFile } from './shared';
import { errorText } from '@/hooks/use-workspace';
import {
  agentCsvTemplate,
  agentInputCsv,
  parseAgentCsv,
} from '@/lib/agent-input';
import type { WorkspaceSettings } from '@/lib/policy';
import { Input } from '@/components/ui/input';

export function AgentPanel({
  run,
  settings,
  busy,
  onRun,
  onReview,
  onLedger,
}: {
  run: StoredRun | null;
  settings: WorkspaceSettings;
  busy: boolean;
  onRun: (
    mode: 'live' | 'recorded',
    custom?: { csv: string; departmentBudgetUsd: number },
  ) => Promise<void>;
  onReview: () => void;
  onLedger: () => void;
}) {
  const [availability, setAvailability] = useState<{
    liveAvailable: boolean;
    model: string;
    recordingModel: string;
    recordedAt: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'live' | 'recorded' | null>(null);
  const [custom, setCustom] = useState(run?.aiTrace?.version === 2);
  const [csv, setCsv] = useState(() =>
    run?.aiTrace?.input ? agentInputCsv(run.aiTrace.input) : '',
  );
  const [budget, setBudget] = useState(
    String(run?.aiTrace?.input?.departmentBudgetUsd ?? 4000000),
  );
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);
  const preview = useMemo(() => {
    if (!csv.trim()) return null;
    try {
      return {
        input: parseAgentCsv(csv, settings.policy, Number(budget)),
        error: '',
      };
    } catch (cause) {
      return { input: null, error: errorText(cause) };
    }
  }, [csv, budget, settings.policy]);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<NonNullable<typeof availability>>('/api/agents', {
      signal: controller.signal,
    })
      .then(setAvailability)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      });
    return () => controller.abort();
  }, []);
  const start = async (next: 'live' | 'recorded') => {
    setMode(next);
    setError('');
    try {
      await onRun(
        next,
        custom ? { csv, departmentBudgetUsd: Number(budget) } : undefined,
      );
    } catch {
      // The workspace already presents a persistent, retryable error notice.
    } finally {
      setMode(null);
    }
  };
  const trace = run?.aiTrace;
  return (
    <>
      <SectionTitle
        eyebrow="AGENT WORKFLOW"
        title="讓 AI 提案，讓風險先被看見"
        description="讓各部門先規劃，再合併檢查整體資金風險。人工保留最後決定權。"
      />
      <div className="hb-agent-source hb-segments" aria-label="AI 發票來源">
        <button
          disabled={busy}
          aria-pressed={!custom}
          onClick={() => setCustom(false)}
        >
          內建展示案例
        </button>
        <button
          disabled={busy}
          aria-pressed={custom}
          onClick={() => setCustom(true)}
        >
          自訂發票清單
        </button>
      </div>
      <div className="hb-card hb-agent-intro">
        <div>
          <span className="hb-soft-label">
            <Bot size={15} />{' '}
            {custom ? '自訂發票 · 分部門規劃' : '合成發票 · 真實模型推論'}
          </span>
          <h2>{custom ? '帶入自己的付款情境' : '個別合理，合在一起呢？'}</h2>
          <p>
            {custom
              ? '提供發票、到期條件與部門預算。每個代理只看見本部門的清單；金額、幣別與收款人由原始資料固定，模型只能提出付款或延後。'
              : '每個代理看見 4 張到期發票、400 萬美元部門預算與 100 萬美元單筆上限。付款金額和收款對象來自固定清單，模型只能提出付款或延後。'}
          </p>
          <p className="hb-muted">
            即時模式需要本機
            Ollama。重現模式使用隨作品附上的原始推論紀錄，不會呼叫模型，也不會移轉資金。
          </p>
        </div>
        <div className="hb-agent-actions">
          <Button
            className="hb-primary"
            disabled={
              busy ||
              reading ||
              !availability?.liveAvailable ||
              (custom && !preview?.input)
            }
            onClick={() => {
              void start('live');
            }}
          >
            <Play size={15} />
            {busy && mode === 'live'
              ? '部門代理正在規劃…'
              : '執行即時 AI 工作流'}
          </Button>
          {!custom && (
            <Button
              className="hb-secondary"
              disabled={busy || !availability}
              onClick={() => {
                void start('recorded');
              }}
            >
              <History size={15} />
              {busy && mode === 'recorded' ? '正在重現…' : '重現已錄製推論'}
            </Button>
          )}
          <small>
            {availability
              ? `${availability.liveAvailable ? '本機模型：' + availability.model : '此環境未啟用即時模型'} · 錄製模型：${availability.recordingModel}`
              : '讀取模型狀態…'}
          </small>
        </div>
      </div>
      {custom && (
        <section className="hb-card hb-agent-input">
          <div className="hb-card-header">
            <h2>發票與預算</h2>
            <span className="hb-soft-label">最多 3 部門 · 24 張發票</span>
          </div>
          <div className="hb-card-body">
            <div className="hb-review-controls">
              <Button
                className="hb-secondary"
                disabled={busy || reading}
                onClick={() => {
                  fileVersion.current++;
                  setCsv(agentCsvTemplate);
                  setError('');
                }}
              >
                載入六張示範發票
              </Button>
              <Button
                className="hb-secondary"
                onClick={() =>
                  saveFile(
                    agentCsvTemplate,
                    'herdbrake-ai-invoices.csv',
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <Download size={15} />
                下載 AI 範本
              </Button>
              <Button
                className="hb-secondary"
                disabled={busy || reading}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={15} />
                {reading ? '讀取中…' : '選擇 CSV'}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                aria-label="上傳 AI 發票 CSV"
                className="sr-only"
                disabled={busy || reading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  const version = ++fileVersion.current;
                  setError('');
                  setCsv('');
                  if (file.size > 32768) {
                    setError('發票 CSV 上限為 32 KB。');
                    return;
                  }
                  setReading(true);
                  void file
                    .text()
                    .then((value) => {
                      if (version === fileVersion.current) setCsv(value);
                    })
                    .catch((cause) => {
                      if (version === fileVersion.current)
                        setError(errorText(cause));
                    })
                    .finally(() => {
                      if (version === fileVersion.current) setReading(false);
                    });
                }}
              />
            </div>
            <div className="hb-field">
              <label htmlFor="agent-budget">每個部門的可用預算（USD）</label>
              <Input
                id="agent-budget"
                className="hb-input"
                type="number"
                min="0.01"
                max="1000000000"
                step="0.01"
                value={budget}
                disabled={busy}
                onChange={(e) => setBudget(e.target.value)}
              />
              <small>
                模型規劃參考，後端也會檢查每個部門的累計核准額度。整批仍受{' '}
                {settings.policy.liquidityFloor}% 流動性底線限制。
              </small>
            </div>
            <div className="hb-field">
              <label htmlFor="agent-csv">發票 CSV 內容</label>
              <textarea
                id="agent-csv"
                className="hb-textarea hb-csv-editor"
                value={csv}
                disabled={busy}
                placeholder={agentCsvTemplate}
                onChange={(e) => {
                  fileVersion.current++;
                  setReading(false);
                  setCsv(e.target.value);
                  setError('');
                }}
              />
              <small>
                description 填寫到期時間與業務背景；每個部門最多 8
                張。確認執行時才會將資料送到設定的模型服務。
              </small>
            </div>
            {preview?.error && (
              <p className="hb-issue" role="alert">
                {preview.error}
              </p>
            )}
            {preview?.input && (
              <output className="hb-notice">
                {preview.input.invoices.length} 張發票 ·{' '}
                {new Set(preview.input.invoices.map((i) => i.entity)).size}{' '}
                個部門 · 欄位與單筆政策檢查通過。核准仍需人工確認。
              </output>
            )}
            <Button
              className="hb-primary"
              disabled={
                busy ||
                reading ||
                !availability?.liveAvailable ||
                !preview?.input
              }
              onClick={() => {
                void start('live');
              }}
            >
              <Play size={15} />
              {busy && mode === 'live'
                ? '正在規劃自訂發票…'
                : '確認並規劃自訂發票'}
            </Button>
          </div>
        </section>
      )}
      {busy && mode === 'live' && (
        <output className="hb-notice">
          正在依序執行部門代理，最多約三分鐘。全部回應通過驗證後才會建立批次；失敗不會以規則結果冒充模型。
        </output>
      )}
      {error && (
        <p role="alert" className="hb-notice error">
          {error}
        </p>
      )}
      {trace && run && (
        <>
          <div className="hb-agent-result">
            <div>
              <span className="hb-soft-label">
                {trace.mode === 'live' ? '本次即時推論' : '原始推論重現'}
                {' · '}
                {trace.version === 2 ? '自訂發票' : '內建合成發票'}
              </span>
              <h2>{run.intentCount} 個提案，已交由風險引擎審查</h2>
              <p>
                原始推論時間：
                {new Date(trace.recordedAt).toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei',
                })}{' '}
                · {trace.sessions[0].model}
              </p>
            </div>
            <StatusBadge state={run.risk.state} />
          </div>
          <div className="hb-agent-grid">
            {trace.sessions.map((session) => (
              <article className="hb-card" key={session.agent}>
                <div className="hb-card-header">
                  <h2>
                    <Bot size={18} /> {session.agent}
                  </h2>
                  <span className="hb-soft-label">
                    {(session.durationMs / 1000).toFixed(1)} 秒
                  </span>
                </div>
                <div className="hb-card-body">
                  <p className="hb-muted">
                    {session.model} ·{' '}
                    {session.inputTokens + session.outputTokens} tokens
                  </p>
                  {session.decisions.map((decision) => (
                    <div className="hb-agent-decision" key={decision.invoiceId}>
                      <div>
                        <strong>{decision.invoiceId}</strong>
                        <span
                          className={`hb-soft-label ${decision.action === 'PAY' ? 'hb-agent-pay' : ''}`}
                        >
                          {decision.action === 'PAY' ? '提議付款' : '提議延後'}
                        </span>
                      </div>
                      <p>{decision.reason}</p>
                    </div>
                  ))}
                  <details className="hb-agent-raw">
                    <summary>查看提示與原始回應</summary>
                    <pre>{session.prompt}</pre>
                    <pre>{session.response}</pre>
                  </details>
                </div>
              </article>
            ))}
          </div>
          <div className="hb-card hb-agent-intro">
            <div>
              <h2>
                <ShieldCheck size={19} /> 風險引擎接手核准邊界
              </h2>
              <p>
                提議流出 {money(run.risk.proposedOutflow)} · 整批資金緩衝{' '}
                {run.risk.projectedBuffer.toFixed(2)}% · 政策底線{' '}
                {run.policy.liquidityFloor}%
              </p>
              <p className="hb-muted">
                模型理由不會覆寫政策。每次核准都重新計算累計流出，超過底線便拒絕。推論原文已納入這批的稽核鏈。
              </p>
            </div>
            <div className="hb-agent-actions">
              <Button
                className="hb-primary"
                disabled={
                  busy || !run.risk.intents.some((i) => i.status === 'HELD')
                }
                onClick={onReview}
              >
                審查並分批核准 <ArrowRight size={15} />
              </Button>
              <Button
                className="hb-secondary"
                disabled={busy}
                onClick={onLedger}
              >
                查看付款清單
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
