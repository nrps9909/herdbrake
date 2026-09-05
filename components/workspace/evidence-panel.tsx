'use client';
import { useState } from 'react';
import {
  Check,
  Download,
  Fingerprint,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StoredRun } from '@/lib/contracts';
import { assuranceApi } from '@/lib/client-api';
import { presentAuditEvent } from '@/lib/audit-presentation';
import { EmptyState, SectionTitle, saveFile } from './shared';
import { errorText } from '@/hooks/use-workspace';
import { EvidenceVerifier } from './evidence-verifier';
import type { verifyEvidence } from '@/lib/evidence-verifier';
type Evidence = {
  audit: { chainValid: boolean };
  commitmentsValid: boolean;
  releaseStateValid: boolean;
  policyValid: boolean;
  releasePolicyValid: boolean;
  evidenceHash: string;
  generatedAt: string;
};
export function EvidencePanel({
  run,
  busy,
  onReplay,
  onImport,
}: {
  run: StoredRun | null;
  busy: boolean;
  onReplay: () => Promise<unknown>;
  onImport: () => void;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<Awaited<
    ReturnType<typeof verifyEvidence>
  > | null>(null);
  if (!run)
    return (
      <>
        <EvidenceVerifier />
        <EmptyState
          title="建立批次後即可查看證據"
          description="每次評估與審核都會留下事件紀錄，可驗證並完整下載。"
          onAction={onImport}
        />
      </>
    );
  const verify = async (download = false) => {
    setChecking(true);
    setError('');
    try {
      const value = (await assuranceApi.evidence(run.runId)) as Evidence;
      const { verifyEvidence: recheck } =
        await import('@/lib/evidence-verifier');
      setVerification(await recheck(value));
      setEvidence(value);
      if (download)
        saveFile(
          JSON.stringify(value, null, 2),
          `herdbrake-${run.runId}.json`,
          'application/json',
        );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setChecking(false);
    }
  };
  const checks = [
    ['資料格式與範圍', verification?.schema],
    ['證據包指紋', verification?.packageHash],
    ['事件鏈完整性', verification?.auditChain],
    ['原始付款資料', verification?.originalIntentCommitments],
    ['審核狀態一致性', verification?.releaseState],
    ['政策快照一致性', verification?.policySnapshot],
    ['累計核准與部門額度', verification?.releasePolicy],
    ['模型原文與發票映射', verification?.modelRecording],
    ['伺服器結果交叉比對', verification?.reportedChecks],
  ] as const;
  return (
    <>
      <SectionTitle
        eyebrow="AUDIT & EVIDENCE"
        title="每一步，都留下可信紀錄"
        description={`${run.name} · ${run.auditEvents.length} 筆事件`}
      >
        <Button
          className="hb-secondary"
          disabled={checking || busy}
          onClick={() => {
            void verify(true);
          }}
        >
          <Download size={15} />
          匯出完整證據
        </Button>
      </SectionTitle>
      {error && (
        <p className="hb-notice error" role="alert">
          {error}
        </p>
      )}
      <div className="hb-view-grid">
        <div className="hb-card">
          <div className="hb-card-header">
            <h2>批次事件時間軸</h2>
            <span className="hb-soft-label">Asia / Taipei</span>
          </div>
          <div className="hb-timeline">
            {run.auditEvents
              .slice()
              .reverse()
              .map((event) => {
                const display = presentAuditEvent(event);
                return (
                  <article className="hb-event" key={event.id}>
                    <span className={`hb-event-icon ${display.tone}`}>
                      <Check size={15} />
                    </span>
                    <div>
                      <div className="hb-event-header">
                        <h3>{display.title}</h3>
                        <time dateTime={event.createdAt}>{display.time}</time>
                      </div>
                      <p>{display.detail}</p>
                      <details>
                        <summary className="hb-link">查看事件指紋</summary>
                        <p className="hb-hash">{event.eventHash}</p>
                      </details>
                    </div>
                  </article>
                );
              })}
          </div>
        </div>
        <aside className="hb-card hb-side-card">
          <div className="hb-card-header">
            <h2>驗證中心</h2>
            <Fingerprint size={19} className="hb-muted" />
          </div>
          <div className="hb-card-body">
            <div className="hb-help-list">
              <p>
                重新讀取資料庫，再於此瀏覽器重算雜湊、付款狀態、模型來源及政策額度。
              </p>
            </div>
            {checks.map(([label, valid]) => (
              <div className="hb-integrity-row" key={label}>
                <span>{label}</span>
                <strong className={valid === false ? 'invalid' : ''}>
                  {valid === undefined
                    ? '尚未驗證'
                    : valid === null
                      ? '不適用'
                      : valid
                        ? '通過'
                        : '異常'}
                </strong>
              </div>
            ))}
            <p className="hb-hash" title="目前稽核鏈指紋">
              {run.auditHead}
            </p>
            <Button
              className="hb-primary hb-full"
              disabled={checking || busy}
              onClick={() => {
                void verify();
              }}
            >
              <ShieldCheck size={15} />
              {checking ? '正在驗證…' : evidence ? '重新驗證' : '驗證此批次'}
            </Button>
            {evidence && (
              <p className="hb-description">
                驗證時間：
                {new Date(evidence.generatedAt).toLocaleTimeString('zh-TW')}
              </p>
            )}
            <Button
              className="hb-secondary hb-full"
              style={{ marginTop: 12 }}
              disabled={busy || checking}
              onClick={() => {
                setEvidence(null);
                setVerification(null);
                void onReplay().catch(() => undefined);
              }}
            >
              <RefreshCw size={15} />
              檢查重播防護
            </Button>
          </div>
          <div className="hb-card-footer">
            證據包含原始資料、政策、紀錄與驗證結果。
          </div>
        </aside>
      </div>
      <EvidenceVerifier />
    </>
  );
}
