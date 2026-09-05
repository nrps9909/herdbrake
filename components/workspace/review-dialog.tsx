'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ReleaseInput, StoredRun } from '@/lib/contracts';
import { amountInUsd } from '@/lib/herdbrake';
import { planRelease } from '@/lib/release-plan';
import { ApiError } from '@/lib/errors';
import { money } from './shared';
import { errorText } from '@/hooks/use-workspace';
export function ReviewDialog({
  run,
  busy,
  initialCount,
  onClose,
  onRelease,
}: {
  run: StoredRun;
  busy: boolean;
  initialCount: number;
  onClose: () => void;
  onRelease: (
    input: Omit<ReleaseInput, 'idempotencyKey' | 'expectedAuditHead'>,
  ) => Promise<unknown>;
}) {
  const [count, setCount] = useState(initialCount);
  const [prioritize, setPrioritize] = useState(true);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const held = run.risk.intents.filter((item) => item.status === 'HELD');
  const plan = planRelease(run.risk.intents, count, prioritize, run.policy);
  const candidates = plan.candidates;
  const total = candidates.reduce(
    (sum, item) => sum + amountInUsd(item, run.policy),
    0,
  );
  const submit = async () => {
    setError('');
    try {
      await onRelease({
        count,
        prioritizeCritical: prioritize,
        authorizationReason: reason.trim(),
        confirmed: true,
      });
      onClose();
    } catch (cause) {
      const mayHaveCommitted =
        !(cause instanceof ApiError) || cause.status >= 500;
      setUncertain(mayHaveCommitted);
      setError(
        `${errorText(cause)}${mayHaveCommitted ? ' 請重試以確認同一筆請求的結果。' : ''}`,
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="hb-dialog" showCloseButton={!busy}>
        <div>
          <p className="hb-eyebrow">REVIEW & AUTHORIZE</p>
          <DialogTitle className="hb-dialog-title">
            確認這一批付款意圖
          </DialogTitle>
          <DialogDescription className="hb-dialog-description">
            {run.name} · 審核內容將記錄在此批次的稽核紀錄中。
          </DialogDescription>
        </div>
        <div>
          <label className="hb-slider-label" htmlFor="review-count">
            本次審核筆數<strong>{candidates.length} 筆</strong>
          </label>
          <input
            id="review-count"
            type="range"
            min={1}
            max={Math.max(1, Math.min(10, held.length))}
            value={Math.min(count, Math.max(1, held.length))}
            disabled={busy || uncertain}
            onChange={(e) => {
              setCount(Number(e.target.value));
              setConfirmed(false);
            }}
            style={{ width: '100%', accentColor: '#5264e9' }}
          />
        </div>
        <label className="hb-confirm">
          <input
            type="checkbox"
            checked={prioritize}
            disabled={busy || uncertain}
            onChange={(e) => {
              setPrioritize(e.target.checked);
              setConfirmed(false);
            }}
          />
          <span>優先審核關鍵付款；同優先序按換算美元金額由小到大。</span>
        </label>
        <div className="hb-review-list">
          {candidates.map((item) => (
            <div className="hb-review-item" key={item.id}>
              <div>
                {item.entity}
                {item.critical ? ' · 關鍵' : ''}
                <small>
                  {item.id} → {item.destination}
                </small>
              </div>
              <strong>{money(item.amount, item.currency)}</strong>
            </div>
          ))}
        </div>
        <div className="hb-review-total">
          <span>本次合計（依批次匯率換算）</span>
          <strong>{money(total)}</strong>
        </div>
        <output className={`hb-release-check ${plan.allowed ? '' : 'blocked'}`}>
          <strong>
            核准後保留 {plan.projectedBuffer.toFixed(2)}% · 底線{' '}
            {run.policy.liquidityFloor}%
          </strong>
          <span>
            先前已核准流出 {money(plan.approvedOutflow)} · 本次新增流出{' '}
            {money(plan.batchOutflow)}
          </span>
          <span>
            剩餘可核准額度 {money(plan.remainingBudget)}
            ，延後支付與保留現金不占用額度。
          </span>
          {!plan.withinFloor && (
            <b>超出可核准額度 {money(plan.shortfall)}，請減少本次筆數。</b>
          )}
          {!!plan.overLimitIds.length && (
            <b>部分意圖超過此批次的單筆上限，無法核准。</b>
          )}
        </output>
        <div className="hb-field">
          <label htmlFor="review-reason">核准理由</label>
          <textarea
            id="review-reason"
            className="hb-textarea"
            style={{ minHeight: 80 }}
            value={reason}
            maxLength={160}
            disabled={busy || uncertain}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：已完成供應商資料核對，核准本期必要付款"
          />
          <small>8–160 個字元，與核准者及付款範圍一同保存。</small>
        </div>
        <label className="hb-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            我已核對上述 {candidates.length}{' '}
            筆資料與金額，確認將其標示為已核准。這項操作不會移動資金。
          </span>
        </label>
        {error && (
          <p role="alert" className="hb-issue">
            {error}
          </p>
        )}
        <div className="hb-dialog-actions">
          <Button className="hb-secondary" disabled={busy} onClick={onClose}>
            返回清單
          </Button>
          <Button
            className="hb-primary"
            disabled={
              busy || !confirmed || reason.trim().length < 8 || !plan.allowed
            }
            onClick={() => {
              void submit();
            }}
          >
            <ShieldCheck size={16} />
            {busy
              ? '正在記錄…'
              : uncertain
                ? '重試原審核請求'
                : `確認核准 ${candidates.length} 筆`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
