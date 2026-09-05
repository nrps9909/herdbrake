'use client';
import { useRef, useState } from 'react';
import { FileCheck2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { verifyEvidence } from '@/lib/evidence-verifier';
import { errorText } from '@/hooks/use-workspace';

const labels = {
  schema: '資料格式與範圍',
  packageHash: '證據包指紋',
  auditChain: '事件鏈與末端指紋',
  originalIntentCommitments: '原始付款承諾',
  policySnapshot: '政策快照',
  releaseState: '核准事件與付款狀態',
  releasePolicy: '累計額度與部門預算',
  modelRecording: '模型原文與發票映射',
  reportedChecks: '伺服器結果交叉比對',
};
type Checks = Awaited<ReturnType<typeof verifyEvidence>>;
export function EvidenceVerifier() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Checks | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const verify = async (source: string) => {
    setResult(null);
    setError('');
    if (new TextEncoder().encode(source).length > 2_097_152)
      throw new Error('證據檔上限為 2 MB。');
    let payload: unknown;
    try {
      payload = JSON.parse(source);
    } catch {
      throw new Error('無法解析 JSON，請選擇完整的證據包。');
    }
    const { verifyEvidence: runChecks } =
      await import('@/lib/evidence-verifier');
    setResult(await runChecks(payload));
  };
  const good =
    result && Object.values(result).every((value) => value !== false);
  return (
    <section className="hb-card hb-independent-verifier">
      <div className="hb-card-header">
        <h2>
          <FileCheck2 size={19} /> 獨立驗證證據檔
        </h2>
        <span className="hb-soft-label">在此瀏覽器計算</span>
      </div>
      <div className="hb-card-body">
        <p className="hb-muted">
          選擇匯出的
          JSON，重新計算雜湊、核准狀態、模型紀錄與額度。檔案內容不會上傳，也不需要登入。
        </p>
        <div className="hb-review-controls">
          <Button
            className="hb-secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} />
            {busy ? '正在驗證…' : '選擇證據 JSON'}
          </Button>
          {fileName && <span className="hb-muted">{fileName}</span>}
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="上傳待驗證的證據檔"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setError('');
              setResult(null);
              setFileName(file.name);
              setText('');
              if (file.size > 2_097_152) {
                setError('證據檔上限為 2 MB。');
                return;
              }
              setBusy(true);
              void file
                .text()
                .then(verify)
                .catch((cause) => setError(errorText(cause)))
                .finally(() => setBusy(false));
            }}
          />
        </div>
        <details className="hb-field">
          <summary className="hb-link">或貼上 JSON 證據內容</summary>
          <label htmlFor="evidence-json" className="sr-only">
            JSON 證據內容
          </label>
          <textarea
            id="evidence-json"
            className="hb-textarea hb-csv-editor"
            value={text}
            disabled={busy}
            maxLength={2_097_152}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
              setError('');
              setFileName('');
            }}
            placeholder="貼上完整的 HerdBrake JSON 證據包"
          />
          <Button
            className="hb-primary"
            disabled={busy || !text.trim()}
            onClick={() => {
              setBusy(true);
              void verify(text)
                .catch((cause) => setError(errorText(cause)))
                .finally(() => setBusy(false));
            }}
          >
            驗證貼上的證據
          </Button>
        </details>
        {error && (
          <p className="hb-issue" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div aria-live="polite">
            <p className={`hb-notice ${good ? '' : 'error'}`}>
              {good
                ? '檢查通過：證據內容與核准紀錄一致。'
                : '檢查未通過：部分資料不一致，請勿將此檔案視為有效核准依據。'}
            </p>
            <div className="hb-verifier-grid">
              {Object.entries(labels).map(([key, label]) => {
                const value = result[key as keyof Checks];
                return (
                  <div className="hb-integrity-row" key={key}>
                    <span>{label}</span>
                    <strong className={value === false ? 'invalid' : ''}>
                      {value === null ? '不適用' : value ? '通過' : '異常'}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="hb-description">
          此檢查證明資料的內部一致性；沒有外部可信簽章時，無法證明提供者身分或整包資料的真實來源。
        </p>
      </div>
    </section>
  );
}
