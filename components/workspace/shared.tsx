'use client';
import {
  ArrowRight,
  FileSpreadsheet,
  FlaskConical,
  Inbox,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RunSummary } from '@/lib/workspace-types';
import { dateLabel } from '@/lib/workspace-types';
import type { RiskResult } from '@/lib/herdbrake';

export const stateNames = {
  NORMAL: '風險正常',
  REVIEW: '建議覆核',
  CRITICAL: '高風險',
};
export function StatusBadge({ state }: { state: RiskResult['state'] }) {
  return (
    <span className={`hb-badge ${state.toLowerCase()}`}>
      <span />
      {stateNames[state]}
    </span>
  );
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="hb-brand">
      <span className="hb-brand-icon">
        <ShieldCheck size={22} />
      </span>
      {!compact && (
        <span>
          HerdBrake<span className="hb-brand-sub">TREASURY WORKSPACE</span>
        </span>
      )}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  onAction,
  action = '建立第一筆批次',
}: {
  title: string;
  description: string;
  onAction?: () => void;
  action?: string;
}) {
  return (
    <div className="hb-empty">
      <span className="hb-empty-icon">
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {onAction && (
        <Button className="hb-primary" onClick={onAction}>
          {action}
          <ArrowRight size={16} />
        </Button>
      )}
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="hb-section-title">
      <div>
        {eyebrow && <p className="hb-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="hb-description">{description}</p>}
      </div>
      {children && <div className="hb-title-actions">{children}</div>}
    </div>
  );
}
export function RunTable({
  items,
  onOpen,
  emptyAction,
}: {
  items: RunSummary[];
  onOpen: (id: string) => void;
  emptyAction?: () => void;
}) {
  if (!items.length)
    return (
      <EmptyState
        title="還沒有符合條件的批次"
        description="匯入付款清單，或先用情境測試熟悉工作流程。"
        onAction={emptyAction}
      />
    );
  return (
    <div className="hb-table-scroll">
      <table className="hb-table">
        <caption className="sr-only">批次紀錄與風險狀態</caption>
        <thead>
          <tr>
            <th scope="col">批次名稱</th>
            <th scope="col">風險判斷</th>
            <th scope="col">付款意圖</th>
            <th scope="col">待審查</th>
            <th scope="col">建立時間</th>
            <th scope="col">
              <span className="sr-only">開啟</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <button
                  className="hb-run-name"
                  aria-label={`開啟 ${item.name || '情境測試'}`}
                  onClick={() => onOpen(item.id)}
                >
                  <span className={`hb-file-icon ${item.source}`}>
                    {item.source === 'import' ? (
                      <FileSpreadsheet size={19} />
                    ) : (
                      <FlaskConical size={19} />
                    )}
                  </span>
                  <span>
                    <strong>{item.name || '情境測試'}</strong>
                    <small>
                      {item.source === 'ai'
                        ? 'AI 付款提案'
                        : item.source === 'import'
                          ? 'CSV 匯入'
                          : '情境模擬'}{' '}
                      · {item.id.slice(-8)}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <StatusBadge state={item.state} />
              </td>
              <td className="hb-numeric">
                {item.intentCount} <span className="hb-muted">筆</span>
              </td>
              <td>
                <span
                  className={item.heldCount ? 'hb-pending-count' : 'hb-muted'}
                >
                  {item.heldCount}
                </span>
              </td>
              <td className="hb-muted hb-nowrap">
                {dateLabel(item.createdAt)}
              </td>
              <td>
                <button
                  className="hb-icon-button"
                  onClick={() => onOpen(item.id)}
                  aria-label={`開啟 ${item.name}`}
                >
                  <ArrowRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function saveFile(value: string, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const money = (amount: number, currency = 'USD') =>
  (currency === 'TWD' ? 'NT$' : currency === 'USDC' ? 'USDC ' : 'US$') +
  new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
