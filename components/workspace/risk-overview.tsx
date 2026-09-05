'use client';
import {
  ArrowRight,
  CheckCheck,
  CircleAlert,
  FileStack,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StoredRun } from '@/lib/contracts';
import type { RunList } from '@/lib/workspace-types';
import { RunTable, SectionTitle, StatusBadge } from './shared';
import type { AgentAction } from '@/lib/herdbrake';
const actionNames: Record<AgentAction, string> = {
  PAY: '支付',
  TRANSFER: '資金轉移',
  DELAY: '延後支付',
  BUFFER: '保留現金',
  USDC: '穩定幣',
};
const colors: Record<AgentAction, string> = {
  PAY: '#17a583',
  TRANSFER: '#5265e8',
  DELAY: '#edac45',
  BUFFER: '#89a1c9',
  USDC: '#9775d9',
};
export function RiskOverview({
  list,
  run,
  onOpen,
  onImport,
  onLab,
  onReview,
}: {
  list: RunList | null;
  run: StoredRun | null;
  onOpen: (id: string) => void;
  onImport: () => void;
  onLab: () => void;
  onReview: () => void;
}) {
  const summary = list?.summary;
  const counts = run?.risk.intents.reduce(
    (acc, item) => {
      acc[item.action]++;
      return acc;
    },
    { PAY: 0, TRANSFER: 0, DELAY: 0, BUFFER: 0, USDC: 0 },
  ) ?? { PAY: 0, TRANSFER: 0, DELAY: 0, BUFFER: 0, USDC: 0 };
  const buffer = run?.risk.projectedBuffer ?? 0;
  return (
    <>
      <SectionTitle
        eyebrow="YOUR CONTROL ROOM"
        title="工作總覽"
        description="掌握付款批次的整體風險，讓每一次核准都有依據。"
      >
        <Button className="hb-secondary" onClick={onLab}>
          執行情境測試
        </Button>
        <Button className="hb-primary" onClick={onImport}>
          匯入付款批次
          <ArrowRight size={16} />
        </Button>
      </SectionTitle>
      <div className="hb-stat-grid">
        {[
          {
            label: '累計批次',
            value: summary?.runCount,
            icon: FileStack,
            note: '工作區內的所有紀錄',
            tone: 'blue',
          },
          {
            label: '待審付款意圖',
            value: summary?.heldCount,
            icon: CircleAlert,
            note: '等待你確認與核准',
            tone: 'amber',
          },
          {
            label: '已核准意圖',
            value: summary?.releasedCount,
            icon: CheckCheck,
            note: '保留完整授權紀錄',
            tone: 'green',
          },
          {
            label: '高風險批次',
            value: summary?.criticalCount,
            icon: ShieldCheck,
            note: '觸發聚合風險規則',
            tone: 'red',
          },
        ].map(({ label, value, icon: Icon, note, tone }) => (
          <article className="hb-stat" key={label}>
            <div>
              <span>{label}</span>
              <span className={`hb-stat-icon ${tone}`}>
                <Icon size={18} />
              </span>
            </div>
            <strong>{value ?? '—'}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      {run ? (
        <div className="hb-overview-grid">
          <section className="hb-card hb-active-card">
            <header className="hb-card-header">
              <div>
                <p className="hb-eyebrow">CURRENT BATCH</p>
                <h2>{run.name}</h2>
              </div>
              <StatusBadge state={run.risk.state} />
            </header>
            <div className="hb-active-body">
              <div className="hb-gauge">
                <svg
                  viewBox="0 0 200 125"
                  aria-label={`預計保留流動性 ${buffer.toFixed(1)}%，政策底線 ${run.risk.liquidityFloor}%`}
                >
                  <path
                    d="M 22 103 A 78 78 0 0 1 178 103"
                    fill="none"
                    stroke="#edf0f7"
                    strokeWidth="13"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 22 103 A 78 78 0 0 1 178 103"
                    fill="none"
                    stroke={
                      buffer < run.risk.liquidityFloor ? '#db695d' : '#5366e9'
                    }
                    strokeWidth="13"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray={`${buffer} 100`}
                  />
                  <text
                    x="100"
                    y="85"
                    textAnchor="middle"
                    className="hb-gauge-value"
                  >
                    {buffer.toFixed(1)}%
                  </text>
                  <text
                    x="100"
                    y="108"
                    textAnchor="middle"
                    className="hb-gauge-label"
                  >
                    預計保留流動性
                  </text>
                </svg>
                <span className="hb-gauge-caption">
                  政策底線 {run.risk.liquidityFloor}%
                </span>
              </div>
              <div className="hb-active-summary">
                <p className="hb-muted">
                  {run.source === 'ai' ? 'AI 提案 · 合成發票' : run.source === 'import' ? '你的付款資料' : '模擬情境資料'} ·{' '}
                  {run.intentCount} 筆意圖
                </p>
                <h3>
                  {run.risk.state === 'CRITICAL'
                    ? '這批決策，需要多看一眼。'
                    : run.risk.state === 'REVIEW'
                      ? '先確認集中風險，再繼續。'
                      : '聚合規則通過，準備好審查。'}
                </h3>
                <p>
                  {run.risk.reasonCode === 'HB-LIQ-003'
                    ? '預計現金緩衝低於政策底線，建議縮小核准範圍。'
                    : run.risk.state === 'CRITICAL'
                      ? '多筆意圖採取相同行動，請確認集中決策的影響。'
                      : '可以查看每筆金額與目的地，完成最後的人工確認。'}
                </p>
                <Button
                  className="hb-primary"
                  onClick={onReview}
                  disabled={
                    !run.risk.intents.some((item) => item.status === 'HELD')
                  }
                >
                  {run.risk.intents.some((item) => item.status === 'HELD')
                    ? '開啟批次審查'
                    : '此批次已完成審核'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
            <footer className="hb-card-footer">
              <ShieldCheck size={15} />
              <span>
                政策 v{run.policyRevision} · {run.risk.reasonCode}
              </span>
              <span>僅核准意圖，不移轉資金</span>
            </footer>
          </section>
          <section className="hb-card">
            <header className="hb-card-header">
              <div>
                <p className="hb-eyebrow">FLEET COMPOSITION</p>
                <h2>付款動作分布</h2>
              </div>
              <TrendingUp size={19} className="hb-muted" />
            </header>
            <div className="hb-distribution">
              <div className="hb-distribution-number">
                <strong>
                  {Math.round(run.risk.directionalAgreement)}
                  <span>%</span>
                </strong>
                <p>意圖選擇相同行動</p>
              </div>
              <div className="hb-stacked-bar" aria-label="代理行動分布">
                {Object.entries(counts).map(
                  ([action, count]) =>
                    count > 0 && (
                      <span
                        key={action}
                        style={{
                          width: `${(count / run.intentCount) * 100}%`,
                          background: colors[action as AgentAction],
                        }}
                      />
                    ),
                )}
              </div>
              <div className="hb-legend">
                {Object.entries(counts).map(([action, count]) => (
                  <div key={action}>
                    <span>
                      <i
                        style={{ background: colors[action as AgentAction] }}
                      />
                      {actionNames[action as AgentAction]}
                    </span>
                    <strong>
                      {count}
                      <small> 筆</small>
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="hb-onboarding">
          <div className="hb-onboarding-copy">
            <span className="hb-eyebrow">LET’S MAKE YOUR FIRST DECISION</span>
            <h2>從一筆批次，建立清楚的決策流程。</h2>
            <p>
              帶入你的付款清單，或先用內建情境探索。每次檢查、每筆核准，都會留在這個工作區。
            </p>
            <Button className="hb-primary" onClick={onImport}>
              匯入第一筆批次
              <ArrowRight size={16} />
            </Button>
          </div>
          <ol>
            {[
              ['01', '帶入資料', '匯入 CSV，先預覽再儲存。'],
              ['02', '查看風險', '檢查流動性與決策集中程度。'],
              ['03', '核准與留存', '審查付款意圖，匯出決策證據。'],
            ].map(([n, title, desc]) => (
              <li key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="hb-card">
        <header className="hb-card-header">
          <div>
            <h2>最近的批次</h2>
            <p>從紀錄回到每一次決策的當下</p>
          </div>
          <span className="hb-soft-label">{summary?.runCount ?? 0} 個批次</span>
        </header>
        <RunTable
          items={list?.items.slice(0, 5) ?? []}
          onOpen={onOpen}
          emptyAction={onImport}
        />
      </section>
    </>
  );
}
