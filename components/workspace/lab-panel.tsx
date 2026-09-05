'use client';
import { useState } from 'react';
import { Check, Play, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scenarios, runRiskEngine, evaluateRisk } from '@/lib/herdbrake';
import type { ScenarioId } from '@/lib/herdbrake';
import type { WorkspaceSettings } from '@/lib/policy';
import { SectionTitle, StatusBadge, money } from './shared';
export function LabPanel({
  settings,
  busy,
  onRun,
}: {
  settings: WorkspaceSettings;
  busy: boolean;
  onRun: (id: ScenarioId, severity: number) => Promise<unknown>;
}) {
  const [scenarioId, setScenario] = useState<ScenarioId>('stablecoin');
  const [severity, setSeverity] = useState(0.8);
  const risk = evaluateRisk(
    runRiskEngine({
      scenarioId,
      severity,
      liquidityFloor: settings.policy.liquidityFloor,
    }).intents,
    settings.policy.liquidityFloor,
    settings.policy,
  );
  return (
    <>
      <SectionTitle
        eyebrow="SCENARIO LAB"
        title="先演練，再做決定"
        description="用六種可重現的情境，觀察多個財務決策同時發生時的影響。"
      />
      <div className="hb-view-grid">
        <div className="hb-scenario-grid">
          {scenarios.map((scenario) => (
            <button
              className="hb-scenario"
              key={scenario.id}
              aria-pressed={scenario.id === scenarioId}
              disabled={busy}
              onClick={() => setScenario(scenario.id)}
            >
              <div className="hb-scenario-icon">
                <span>{scenario.icon}</span>
                {scenario.id === scenarioId && <Check size={17} />}
              </div>
              <h3>{scenario.shortName}</h3>
              <p>{scenario.description}</p>
            </button>
          ))}
        </div>
        <aside className="hb-card hb-side-card">
          <div className="hb-card-header">
            <h2>調整情境</h2>
            <SlidersHorizontal size={17} className="hb-muted" />
          </div>
          <div className="hb-card-body">
            <label className="hb-slider-label" htmlFor="severity">
              壓力強度<strong>{Math.round(severity * 100)}%</strong>
            </label>
            <input
              id="severity"
              type="range"
              min={10}
              max={100}
              step={5}
              value={severity * 100}
              onChange={(e) => setSeverity(Number(e.target.value) / 100)}
              disabled={busy}
              style={{ width: '100%', accentColor: '#5264e9' }}
            />
            <div className="hb-preview-result">
              <div>
                <span className="hb-muted">即時預覽</span>
                <StatusBadge state={risk.state} />
              </div>
              <div>
                <span className="hb-muted">預估資金緩衝</span>
                <strong>{risk.projectedBuffer.toFixed(1)}%</strong>
              </div>
              <div>
                <span className="hb-muted">提議流出</span>
                <strong>{money(risk.proposedOutflow)}</strong>
              </div>
              <p>
                30 筆模擬付款意圖 ·{' '}
                {settings.revision ? `政策 v${settings.revision}` : '預設政策'}
                <br />
                儲存後才會建立可追溯的批次紀錄。
              </p>
            </div>
            <Button
              className="hb-primary hb-full"
              disabled={busy}
              onClick={() => {
                void onRun(scenarioId, severity).catch(() => undefined);
              }}
            >
              <Play size={15} />
              {busy ? '正在執行…' : '執行並儲存測試'}
            </Button>
          </div>
          <div className="hb-card-footer">
            情境使用合成資料與工作區設定匯率。
          </div>
        </aside>
      </div>
    </>
  );
}
