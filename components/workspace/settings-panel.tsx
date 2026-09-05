'use client';
import { useState } from 'react';
import { Save, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import type { WorkspaceData } from '@/hooks/use-workspace';
import { errorText } from '@/hooks/use-workspace';
import { parsePolicy } from '@/lib/policy';
import type { RiskPolicy, WorkspaceSettings } from '@/lib/policy';
import { dateLabel } from '@/lib/workspace-types';
import { SectionTitle } from './shared';
const fields: Array<{
  key: keyof RiskPolicy;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  help: string;
}> = [
  {
    key: 'openingLiquidity',
    label: '期初可用資金',
    unit: 'USD',
    min: 1000,
    max: 1e12,
    step: 1,
    help: '作為整批流出後資金緩衝的計算基準。',
  },
  {
    key: 'liquidityFloor',
    label: '最低資金緩衝',
    unit: '%',
    min: 50,
    max: 95,
    step: 1,
    help: '低於此比例時觸發高風險提示。',
  },
  {
    key: 'herdThreshold',
    label: '方向一致性門檻',
    unit: '%',
    min: 50,
    max: 100,
    step: 1,
    help: '達到此比例的付款意圖選擇相同行動時，觸發高風險提示。',
  },
  {
    key: 'concentrationThreshold',
    label: '目的地集中門檻',
    unit: '%',
    min: 10,
    max: 100,
    step: 1,
    help: '付款意圖集中於相同目的地時，提示進一步覆核。',
  },
  {
    key: 'maxIntentUsd',
    label: '單筆匯入金額上限',
    unit: 'USD',
    min: 1,
    max: 1e9,
    step: 1,
    help: 'CSV 匯入時按政策匯率換算並檢查。',
  },
  {
    key: 'twdPerUsd',
    label: '美元兌新台幣',
    unit: 'TWD / USD',
    min: 1,
    max: 1000,
    step: 0.01,
    help: '手動設定評估匯率，不是即時市場報價。',
  },
  {
    key: 'usdcUsd',
    label: 'USDC 估值',
    unit: 'USD / USDC',
    min: 0.01,
    max: 10,
    step: 0.0001,
    help: '用於換算 USDC 付款意圖。',
  },
];
export function SettingsPanel({
  data,
  user,
  busy,
  onSave,
  onRefresh,
}: {
  data: WorkspaceData;
  user: ChatGPTUser;
  busy: boolean;
  onSave: (value: WorkspaceSettings) => Promise<unknown>;
  onRefresh: () => void;
}) {
  const [name, setName] = useState(data.settings.name);
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        fields.map((field) => [
          field.key,
          String(data.settings.policy[field.key]),
        ]),
      ) as Record<keyof RiskPolicy, string>,
  );
  const [error, setError] = useState('');
  const dirty =
    name !== data.settings.name ||
    fields.some(
      (field) => values[field.key] !== String(data.settings.policy[field.key]),
    );
  const submit = async () => {
    setError('');
    try {
      const policy = parsePolicy(
        Object.fromEntries(
          fields.map((field) => [
            field.key,
            values[field.key].trim() ? Number(values[field.key]) : NaN,
          ]),
        ),
      );
      await onSave({ ...data.settings, name, policy });
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="WORKSPACE SETTINGS"
        title="依你的流程，設定每一道規則"
        description="新政策只套用於之後建立的批次；歷史資料會保留當時的評估設定。"
      />
      <div className="hb-view-grid">
        <form
          className="hb-card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="hb-settings-intro">
            <span className="hb-avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.email || '以 ChatGPT 帳號登入'} · 個人工作區</small>
            </div>
          </div>
          <div className="hb-card-body">
            <div className="hb-field">
              <label htmlFor="workspace-name">工作區名稱</label>
              <Input
                id="workspace-name"
                className="hb-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
                disabled={busy}
              />
            </div>
            <div className="hb-form-grid" style={{ marginTop: 27 }}>
              {fields.map((field) => (
                <div className="hb-field" key={field.key}>
                  <label htmlFor={field.key}>
                    {field.label}{' '}
                    <span className="hb-muted">· {field.unit}</span>
                  </label>
                  <Input
                    id={field.key}
                    className="hb-input"
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    required
                    value={values[field.key]}
                    disabled={busy}
                    onChange={(e) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: e.target.value,
                      }))
                    }
                  />
                  <small>{field.help}</small>
                </div>
              ))}
            </div>
            {error && (
              <div role="alert" className="hb-issue" style={{ marginTop: 22 }}>
                {error}{' '}
                <button type="button" className="hb-link" onClick={onRefresh}>
                  重新載入最新政策
                </button>
              </div>
            )}
            <div className="hb-dialog-actions" style={{ marginTop: 25 }}>
              <Button
                type="button"
                className="hb-secondary"
                disabled={busy || !dirty}
                onClick={() => {
                  setName(data.settings.name);
                  setValues(
                    Object.fromEntries(
                      fields.map((field) => [
                        field.key,
                        String(data.settings.policy[field.key]),
                      ]),
                    ) as Record<keyof RiskPolicy, string>,
                  );
                  setError('');
                }}
              >
                還原修改
              </Button>
              <Button
                type="submit"
                className="hb-primary"
                disabled={busy || !dirty || !name.trim()}
              >
                <Save size={15} />
                {busy ? '儲存中…' : '儲存設定'}
              </Button>
            </div>
          </div>
        </form>
        <aside className="hb-card hb-side-card">
          <div className="hb-card-header">
            <h2>政策版本</h2>
            <History size={17} className="hb-muted" />
          </div>
          <div className="hb-card-body">
            <p className="hb-description">
              {data.settings.revision
                ? `目前版本 v${data.settings.revision}`
                : '目前使用預設政策'}
              。每次儲存都保留版本，方便回溯當時的評估依據。
            </p>
            {data.history.length ? (
              data.history.map((item) => (
                <details key={item.revision}>
                  <summary className="hb-policy-version">
                    <strong>版本 {item.revision}</strong>
                    <span>{dateLabel(item.createdAt)}</span>
                  </summary>
                  <div className="hb-help-list">
                    <p>
                      緩衝 {item.policy.liquidityFloor}% · 一致性{' '}
                      {item.policy.herdThreshold}% · 集中度{' '}
                      {item.policy.concentrationThreshold}%<br />
                      期初資金 USD{' '}
                      {item.policy.openingLiquidity.toLocaleString()}
                      <br />
                      匯入上限 USD {item.policy.maxIntentUsd.toLocaleString()}
                      <br />
                      USD/TWD {item.policy.twdPerUsd} · USDC/USD{' '}
                      {item.policy.usdcUsd}
                    </p>
                  </div>
                </details>
              ))
            ) : (
              <p className="hb-description">
                尚無自訂版本。調整左側設定，即可建立第一版政策。
              </p>
            )}
          </div>
          <div className="hb-card-footer">最近 20 個版本</div>
        </aside>
      </div>
    </>
  );
}
