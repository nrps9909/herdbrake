'use client';
import { useEffect, useState } from 'react';
import { Bot, Play, History, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StoredRun } from '@/lib/contracts';
import { apiRequest } from '@/lib/client-api';
import { SectionTitle, StatusBadge, money } from './shared';
import { errorText } from '@/hooks/use-workspace';

export function AgentPanel({
  run,
  busy,
  onRun,
  onReview,
  onLedger,
}: {
  run: StoredRun | null;
  busy: boolean;
  onRun: (mode: 'live' | 'recorded') => Promise<void>;
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
      await onRun(next);
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
        description="三個部門，各自根據同一個付款期限規劃。HerdBrake 合併審查，人工保留最後決定權。"
      />
      <div className="hb-card hb-agent-intro">
        <div>
          <span className="hb-soft-label">
            <Bot size={15} /> 合成發票 · 真實模型推論
          </span>
          <h2>個別合理，合在一起呢？</h2>
          <p>
            每個代理看見 4 張到期發票、400 萬美元部門預算與 100
            萬美元單筆上限。付款金額和收款對象來自固定清單，模型只能提出付款或延後。
          </p>
          <p className="hb-muted">
            即時模式需要本機
            Ollama。重現模式使用隨作品附上的原始推論紀錄，不會呼叫模型，也不會移轉資金。
          </p>
        </div>
        <div className="hb-agent-actions">
          <Button
            className="hb-primary"
            disabled={busy || !availability?.liveAvailable}
            onClick={() => {
              void start('live');
            }}
          >
            <Play size={15} />
            {busy && mode === 'live'
              ? '三個代理正在規劃…'
              : '執行即時 AI 工作流'}
          </Button>
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
          <small>
            {availability
              ? `${availability.liveAvailable ? '本機模型：' + availability.model : '此環境未啟用即時模型'} · 錄製模型：${availability.recordingModel}`
              : '讀取模型狀態…'}
          </small>
        </div>
      </div>
      {busy && mode === 'live' && (
        <output className="hb-notice">
          正在依序執行三個部門代理，最多約三分鐘。全部回應通過驗證後才會建立批次；失敗不會以規則結果冒充模型。
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
