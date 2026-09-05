'use client';
import { useState } from 'react';
import {
  ArrowDownUp,
  CheckCircle2,
  Clock3,
  Download,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { StoredRun } from '@/lib/contracts';
import { amountInUsd } from '@/lib/herdbrake';
import { releasePosition } from '@/lib/release-plan';
import {
  EmptyState,
  SectionTitle,
  StatusBadge,
  money,
  saveFile,
} from './shared';
import { errorText } from '@/hooks/use-workspace';
export function LedgerPanel({
  run,
  busy,
  onReview,
  onImport,
  onEvidence,
}: {
  run: StoredRun | null;
  busy: boolean;
  onReview: () => void;
  onImport: () => void;
  onEvidence: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [amountSort, setAmountSort] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  if (!run)
    return (
      <EmptyState
        title="先開啟一筆付款批次"
        description="從批次紀錄選擇資料，或匯入新的付款清單。"
        onAction={onImport}
        action="匯入付款清單"
      />
    );
  const rows = run.risk.intents
    .filter(
      (item) =>
        (status === 'ALL' || item.status === status) &&
        [item.entity, item.destination, item.id, item.action].some((value) =>
          value.toLowerCase().includes(search.toLowerCase()),
        ),
    )
    .sort((a, b) =>
      amountSort
        ? amountInUsd(b, run.policy) - amountInUsd(a, run.policy)
        : a.id.localeCompare(b.id),
    );
  const held = run.risk.intents.filter((item) => item.status === 'HELD').length;
  const position = releasePosition(run.risk.intents, run.policy);
  const exportCsv = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(run.runId)}/csv`,
        {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
          headers: { 'x-herdbrake-client': 'workspace' },
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || '無法匯出 CSV，請稍後重試。');
      }
      saveFile(
        await response.text(),
        `herdbrake-${run.runId}.csv`,
        'text/csv;charset=utf-8',
      );
    } catch (cause) {
      setDownloadError(errorText(cause));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="PAYMENT INTENTS"
        title={run.name}
        description={`${run.source === 'ai' ? 'AI 付款提案' : run.source === 'import' ? 'CSV 匯入' : '情境模擬'} · ${run.intentCount} 筆付款意圖 · ${run.policyRevision ? `政策 v${run.policyRevision}` : '預設政策'}`}
      >
        <Button
          className="hb-secondary hb-download-link"
          disabled={downloading || busy}
          onClick={() => {
            void exportCsv();
          }}
        >
          <Download size={15} />
          {downloading ? '正在匯出…' : '匯出 CSV'}
        </Button>
        <Button
          className="hb-primary"
          disabled={busy || !held}
          onClick={onReview}
        >
          <ShieldCheck size={15} />
          {held ? '審核放行' : '已完成審核'}
        </Button>
      </SectionTitle>
      {downloadError && (
        <p className="hb-notice error" role="alert">
          {downloadError}
        </p>
      )}
      <section className="hb-release-position" aria-label="核准前後流動性比較">
        <div>
          <span>若整批全部執行</span>
          <strong>{run.risk.projectedBuffer.toFixed(2)}%</strong>
          <small>原始付款清單的預估緩衝</small>
        </div>
        <div className={position.withinFloor ? 'safe' : 'blocked'}>
          <span>依目前核准範圍</span>
          <strong>{position.retainedBuffer.toFixed(2)}%</strong>
          <small>政策底線 {run.policy.liquidityFloor}%</small>
        </div>
        <div>
          <span>已核准流出</span>
          <strong>{money(position.approvedOutflow)}</strong>
          <small>依此批次匯率累計，未實際付款</small>
        </div>
        <div>
          <span>剩餘可核准額度</span>
          <strong>{money(position.remainingBudget)}</strong>
          <small>後端逐次檢查，超額不予核准</small>
        </div>
      </section>
      <div className="hb-card">
        <div className="hb-ledger-summary">
          <StatusBadge state={run.risk.state} />
          <strong>待審核 {held} 筆</strong>
          <span>已核准 {run.intentCount - held} 筆</span>
          <span>預估緩衝 {run.risk.projectedBuffer.toFixed(1)}%</span>
          <button className="hb-link" onClick={onEvidence}>
            查看稽核紀錄 →
          </button>
        </div>
        <div className="hb-toolbar">
          <div className="hb-search">
            <Search size={16} />
            <Input
              className="hb-input"
              aria-label="搜尋付款意圖"
              placeholder="搜尋單位、目的地、識別碼…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="hb-segments">
            {[
              ['ALL', '全部'],
              ['HELD', '待審核'],
              ['RELEASED', '已核准'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!rows.length ? (
          <EmptyState
            title="沒有符合的付款意圖"
            description="試試其他關鍵字，或切換狀態篩選。"
          />
        ) : (
          <div className="hb-table-scroll">
            <table className="hb-table">
              <caption className="sr-only">{run.name} 付款意圖清單</caption>
              <thead>
                <tr>
                  <th scope="col">付款單位 / 識別碼</th>
                  <th scope="col">動作</th>
                  <th scope="col">目的地</th>
                  <th
                    scope="col"
                    aria-sort={amountSort ? 'descending' : 'none'}
                  >
                    <button
                      onClick={() => setAmountSort((value) => !value)}
                      style={{ display: 'flex', gap: 7, alignItems: 'center' }}
                    >
                      金額 <ArrowDownUp size={12} />
                    </button>
                  </th>
                  <th scope="col">審核狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.entity}</strong>
                      {item.critical && (
                        <span className="hb-critical-tag">關鍵</span>
                      )}
                      <small className="hb-intent-id">{item.id}</small>
                    </td>
                    <td>
                      <span className="hb-action-pill">{item.action}</span>
                    </td>
                    <td className="hb-destination">{item.destination}</td>
                    <td className="hb-numeric hb-nowrap">
                      {money(item.amount, item.currency)}
                    </td>
                    <td>
                      <span
                        className={`hb-intent-state ${item.status.toLowerCase()}`}
                      >
                        {item.status === 'RELEASED' ? (
                          <CheckCircle2 size={13} />
                        ) : (
                          <Clock3 size={13} />
                        )}{' '}
                        {item.status === 'RELEASED' ? '已核准' : '待審核'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hb-card-footer">
          顯示 {rows.length} / {run.intentCount} 筆
          <span>核准只記錄審核狀態，未串接實際付款。</span>
        </div>
      </div>
    </>
  );
}
