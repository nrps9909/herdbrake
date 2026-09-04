'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, Banknote, Check, CheckCircle2, ChevronRight, CircleAlert,
  ClipboardCheck, Download, FileCheck2, Fingerprint, Gauge, History, LockKeyhole,
  Network, Pause, Play, RotateCcw, Search, ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  AgentAction, PaymentIntent, ScenarioId, formatMoney, formatPct,
  runRiskEngine, scenarios, selectSafeRelease,
} from '@/lib/herdbrake';

type Tab = 'command' | 'lab' | 'ledger' | 'evidence';
type AuditEvent = { time: string; title: string; detail: string; tone: 'neutral' | 'danger' | 'safe' };
type ModelContext = { registerTool: (tool: unknown) => void; unregisterTool?: (name: string) => void };

declare global { interface Document { modelContext?: ModelContext } }

const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'command', label: 'Command Center', icon: Activity },
  { id: 'lab', label: 'Scenario Lab', icon: SlidersHorizontal },
  { id: 'ledger', label: 'Intent Ledger', icon: ClipboardCheck },
  { id: 'evidence', label: 'Evidence', icon: FileCheck2 },
];

const actionStyles: Record<AgentAction, string> = {
  PAY: 'bg-emerald-400 text-emerald-950', DELAY: 'bg-amber-300 text-amber-950',
  BUFFER: 'bg-sky-400 text-sky-950', TRANSFER: 'bg-rose-400 text-rose-950', USDC: 'bg-violet-400 text-violet-950',
};
const actionMarks: Record<AgentAction, string> = { PAY: '✓', DELAY: 'Ⅱ', BUFFER: '▣', TRANSFER: '→', USDC: '$' };

export default function Home() {
  const [tab, setTab] = useState<Tab>('command');
  const [scenarioId, setScenarioId] = useState<ScenarioId>('stablecoin');
  const [severity, setSeverity] = useState(1);
  const [liquidityFloor, setLiquidityFloor] = useState(75);
  const [running, setRunning] = useState(false);
  const [breakerOpen, setBreakerOpen] = useState(false);
  const [releaseCount, setReleaseCount] = useState(5);
  const [prioritizeCritical, setPrioritizeCritical] = useState(true);
  const [releasedIds, setReleasedIds] = useState<string[]>([]);
  const [replayBlocked, setReplayBlocked] = useState(false);
  const [notice, setNotice] = useState('壓力測試完成：付款批次已在簽署前暫停。');
  const [audit, setAudit] = useState<AuditEvent[]>([
    { time: '14:32:08', title: 'Shared breaker triggered', detail: 'HB-LIQ-003 · Aggregate liquidity floor breach', tone: 'danger' },
    { time: '14:32:07', title: '30 intents evaluated', detail: 'All individual policies passed; aggregate policy failed', tone: 'neutral' },
    { time: '14:32:05', title: 'Scenario signal received', detail: 'USDC/TWD liquidity feed · confidence 0.94', tone: 'neutral' },
  ]);

  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const risk = useMemo(() => runRiskEngine({ scenarioId, severity, liquidityFloor, releasedIds }), [scenarioId, severity, liquidityFloor, releasedIds]);

  const runScenario = useCallback((nextId = scenarioId, nextSeverity = severity) => {
    setRunning(true); setScenarioId(nextId); setSeverity(nextSeverity); setReleasedIds([]); setReplayBlocked(false);
    window.setTimeout(() => {
      const nextScenario = scenarios.find((item) => item.id === nextId) ?? scenarios[0];
      setAudit([
        { time: now(), title: 'Shared breaker triggered', detail: 'Aggregate policy re-evaluated before signing', tone: 'danger' },
        { time: now(-1), title: '30 intents evaluated', detail: 'Individual PASS · aggregate decision HOLD', tone: 'neutral' },
        { time: now(-2), title: 'Scenario signal received', detail: nextScenario.commonSignal, tone: 'neutral' },
      ]);
      setNotice(`${nextScenario.shortName}壓力測試完成：已重新計算 30 筆付款意圖。`); setRunning(false); setTab('command');
    }, 520);
  }, [scenarioId, severity]);

  const stageRelease = useCallback((count = releaseCount) => {
    const held = risk.intents.filter((item) => item.status === 'HELD');
    const chosen = prioritizeCritical ? selectSafeRelease(held, count) : held.slice(0, count).map((item) => item.id);
    setReleasedIds((current) => Array.from(new Set([...current, ...chosen])));
    setAudit((current) => [{ time: now(), title: `${chosen.length} intents staged for release`, detail: `${prioritizeCritical ? 'Critical suppliers first' : 'Original queue order'} · human authorization recorded`, tone: 'safe' }, ...current]);
    setNotice(`已安全放行 ${chosen.length} 筆；其餘付款維持 HOLD，未觸碰真實資金。`); setBreakerOpen(false);
  }, [prioritizeCritical, releaseCount, risk.intents]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      { name: 'run_herdbrake_stress_test', description: 'Run a treasury-agent stress test in HerdBrake.', inputSchema: { type: 'object', properties: { scenarioId: { type: 'string', enum: scenarios.map((s) => s.id) }, severity: { type: 'number', minimum: 0.1, maximum: 1 } }, required: ['scenarioId', 'severity'] }, execute: ({ scenarioId: id, severity: level }: { scenarioId: ScenarioId; severity: number }) => { runScenario(id, level); return { content: [{ type: 'text', text: `Stress test started: ${id}` }] }; } },
      { name: 'stage_herdbrake_release', description: 'Stage a safe, human-authorized subset of held payment intents.', inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['count'] }, execute: ({ count }: { count: number }) => { stageRelease(count); return { content: [{ type: 'text', text: `Staged ${count} intents.` }] }; } },
      { name: 'get_herdbrake_risk_state', description: 'Read the current aggregate risk state.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true }, execute: () => ({ content: [{ type: 'text', text: JSON.stringify({ state: risk.state, directionalAgreement: risk.directionalAgreement, projectedBuffer: risk.projectedBuffer, reasonCode: risk.reasonCode }) }] }) },
    ];
    tools.forEach((tool) => { try { context.registerTool(tool); } catch { /* unsupported preview context */ } });
    return () => tools.forEach((tool) => context.unregisterTool?.(tool.name));
  }, [risk, runScenario, stageRelease]);

  function blockReplay() {
    if (replayBlocked) return;
    setReplayBlocked(true);
    setAudit((current) => [{ time: now(), title: 'Replay attempt rejected', detail: 'Nonce 0xHB004204 already consumed · no duplicate execution', tone: 'safe' }, ...current]);
    setNotice('重播攻擊已阻擋：nonce 已使用，付款批次未重複執行。');
  }

  function downloadEvidence() {
    const evidence = { product: 'HerdBrake Taiwan', generatedAt: new Date().toISOString(), scenario, policy: { version: '2.4.1', liquidityFloor, decision: risk.state === 'CRITICAL' ? 'HOLD' : 'REVIEW' }, metrics: { directionalAgreement: risk.directionalAgreement, destinationConcentration: risk.destinationConcentration, projectedBuffer: risk.projectedBuffer, proposedOutflow: risk.proposedOutflow }, intents: risk.intents, audit };
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'herdbrake-evidence-FX-042.json'; link.click(); URL.revokeObjectURL(url);
    setNotice('稽核證據包已匯出，不含個資與模型思考內容。');
  }

  return <main className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#09111d]/92 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between gap-4 px-4 lg:px-8">
        <button onClick={() => setTab('command')} className="flex items-center gap-3 text-left"><BrandMark /><div><div className="flex items-center gap-2"><span className="font-semibold tracking-tight">HerdBrake</span><span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">TAIWAN LAB</span></div><p className="text-[11px] text-slate-500">Agentic Payment Assurance</p></div></button>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="產品功能">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`nav-tab ${tab === id ? 'nav-tab-active' : ''}`}><Icon />{label}</button>)}</nav>
        <div className="flex items-center gap-2 text-xs text-slate-400"><span className="hidden items-center gap-2 sm:flex"><span className="size-1.5 rounded-full bg-emerald-400" />Simulation</span><span className="rounded-md border border-white/10 px-2 py-1 font-mono">TW-01</span></div>
      </div>
      <nav className="flex overflow-x-auto border-t border-white/6 px-3 lg:hidden" aria-label="產品功能">{tabs.map(({ id, label }) => <button key={id} onClick={() => setTab(id)} className={`mobile-tab ${tab === id ? 'mobile-tab-active' : ''}`}>{label}</button>)}</nav>
    </header>

    <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-8 lg:py-7">
      <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-cyan-300/15 bg-cyan-300/6 px-3.5 py-2.5 text-xs text-cyan-100"><span className="flex items-center gap-2"><CheckCircle2 className="size-4 shrink-0 text-cyan-300" />{notice}</span><button onClick={() => setNotice('系統就緒：所有金流維持在模擬環境。')} aria-label="關閉通知"><X className="size-3.5" /></button></div>
      {tab === 'command' && <CommandCenter risk={risk} scenario={scenario} running={running} onRun={() => runScenario()} onOpenBreaker={() => setBreakerOpen(true)} onNavigate={setTab} />}
      {tab === 'lab' && <ScenarioLab selected={scenarioId} severity={severity} floor={liquidityFloor} running={running} onSelect={setScenarioId} onSeverity={setSeverity} onFloor={setLiquidityFloor} onRun={() => runScenario()} />}
      {tab === 'ledger' && <IntentLedger intents={risk.intents} />}
      {tab === 'evidence' && <EvidencePanel audit={audit} replayBlocked={replayBlocked} onReplay={blockReplay} onDownload={downloadEvidence} risk={risk} />}
    </div>
    <footer className="mx-auto flex max-w-[1500px] flex-col gap-2 border-t border-white/8 px-4 py-5 text-[11px] text-slate-500 sm:flex-row sm:justify-between lg:px-8"><span>HerdBrake Taiwan · Hackathon demonstrator</span><span>Simulation only · No custody · No autonomous execution · Human approval required</span></footer>
    {breakerOpen && <BreakerDialog risk={risk} count={releaseCount} prioritize={prioritizeCritical} onCount={setReleaseCount} onPrioritize={setPrioritizeCritical} onClose={() => setBreakerOpen(false)} onRelease={() => stageRelease()} />}
  </main>;
}

function CommandCenter({ risk, scenario, running, onRun, onOpenBreaker, onNavigate }: { risk: ReturnType<typeof runRiskEngine>; scenario: (typeof scenarios)[number]; running: boolean; onRun: () => void; onOpenBreaker: () => void; onNavigate: (tab: Tab) => void }) {
  const held = risk.intents.filter((i) => i.status === 'HELD').length;
  return <>
    <section className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-cyan-300"><Activity className="size-3.5" /> Live decision surface</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{scenario.name}</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">30 個財務代理各自合規，但同步決策可能擊穿集團流動性；HerdBrake 在付款簽署前攔截。</p></div><Button onClick={onRun} disabled={running} size="lg" className="h-10 bg-cyan-300 px-4 font-semibold text-[#07111d] hover:bg-cyan-200">{running ? <Activity className="animate-pulse" /> : <RotateCcw />}{running ? 'Recomputing risk' : 'Rerun scenario'}</Button></section>
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={Network} label="Directional agreement" value={formatPct(risk.directionalAgreement)} tone="danger" /><Metric icon={Gauge} label="Destination concentration" value={formatPct(risk.destinationConcentration)} tone="danger" /><Metric icon={Banknote} label="Proposed outflow" value={formatMoney(risk.proposedOutflow)} /><Metric icon={Activity} label="Projected buffer" value={formatPct(risk.projectedBuffer)} tone={risk.projectedBuffer < risk.liquidityFloor ? 'danger' : 'safe'} /><Metric icon={CircleAlert} label="Risk state" value={risk.state} tone={risk.state === 'CRITICAL' ? 'danger' : 'safe'} /></section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.75fr)]">
      <div className="panel min-w-0"><div className="panel-header"><div><p className="eyebrow">Fleet correlation</p><h2>Herd Map</h2></div><div className="hidden flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-slate-400 sm:flex">{Object.keys(actionStyles).map((action) => <span key={action} className="flex items-center gap-1.5"><span className={`grid size-3 place-items-center rounded-sm text-[8px] ${actionStyles[action as AgentAction]}`}>{actionMarks[action as AgentAction]}</span>{action}</span>)}</div></div><div className="relative overflow-hidden p-5 sm:p-7"><div className="herd-grid" aria-label="30 treasury agent decisions">{risk.intents.map((intent, index) => <button key={intent.id} className={`agent-node ${actionStyles[intent.action]} ${intent.status === 'RELEASED' ? 'ring-2 ring-white' : ''}`} aria-label={`${intent.entity}: ${intent.action}, ${intent.status}`} title={`${intent.id} · ${intent.action} · ${intent.status}`} style={{ animationDelay: `${index * 14}ms` }}><span>{actionMarks[intent.action]}</span><span className="sr-only">{index + 1}</span></button>)}</div><div className="mt-6 flex flex-col gap-2 border-t border-white/8 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>Common signal: {scenario.commonSignal}</span><span className="font-mono text-slate-500">POLICY v2.4.1 · deterministic</span></div></div></div>
      <aside className="panel overflow-hidden border-rose-400/35"><div className="h-1 bg-rose-400" /><div className="p-5 sm:p-6"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="eyebrow">Pre-execution decision</p><h2 className="mt-1 text-xl font-semibold">Batch #FX-042</h2></div><span className="status-badge status-danger"><Pause />HOLD</span></div><div className="space-y-3 text-sm"><DecisionRow label="Intents received" value="30" /><DecisionRow label="Same defensive action" value={`${risk.leadingCount} agents`} emphasis /><DecisionRow label="Liquidity floor" value={`${Math.round(risk.projectedBuffer - risk.liquidityFloor)}% variance`} emphasis /><DecisionRow label="Execution status" value={`${held} held · ${30 - held} released`} /></div><div className="mt-6 rounded-lg border border-rose-400/25 bg-rose-400/8 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">Reason code</p><p className="mt-1.5 text-sm font-medium">{risk.reasonCode} · Aggregate buffer breach</p><p className="mt-1 text-xs leading-5 text-slate-400">每筆付款皆通過個別限額，但聚合執行不安全。判斷來自可驗證規則，不由 LLM 自行批准。</p></div><Button onClick={onOpenBreaker} className="mt-5 h-10 w-full justify-between bg-white text-[#07111d] hover:bg-slate-200">Open breaker controls <ArrowRight /></Button><button onClick={() => onNavigate('ledger')} className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-slate-400 hover:text-white">Inspect all signed intents <ChevronRight className="size-3" /></button></div></aside>
    </section>
  </>;
}

function ScenarioLab({ selected, severity, floor, running, onSelect, onSeverity, onFloor, onRun }: { selected: ScenarioId; severity: number; floor: number; running: boolean; onSelect: (id: ScenarioId) => void; onSeverity: (n: number) => void; onFloor: (n: number) => void; onRun: () => void }) {
  return <section><PageTitle eyebrow="Deployment rehearsal" title="Scenario Lab" description="上線前先讓 30 個代理遭遇相同衝擊，檢查政策是否會把個別合理決策放大成群體風險。" /><div className="grid gap-5 xl:grid-cols-[1fr_360px]"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{scenarios.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} className={`scenario-card ${selected === item.id ? 'scenario-card-active' : ''}`}><div className="mb-5 flex items-start justify-between"><span className="scenario-icon">{item.icon}</span>{selected === item.id && <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300"><Check className="size-3" />Selected</span>}</div><h3>{item.shortName}</h3><p>{item.description}</p><span className="mt-4 block font-mono text-[10px] text-slate-500">SIGNAL · {item.commonSignal}</span></button>)}</div><aside className="panel h-fit p-5 sm:p-6"><p className="eyebrow">Test configuration</p><h2 className="mt-1 text-lg font-semibold">Guardrail controls</h2><div className="mt-6 space-y-7"><Control label="Shock severity" value={`${Math.round(severity * 100)}%`} detail="影響 agents 同步採取防禦行動的比例"><Slider value={[severity * 100]} min={10} max={100} step={10} onValueChange={(value) => onSeverity(firstSliderValue(value) / 100)} /></Control><Control label="Liquidity floor" value={`${floor}%`} detail="集團付款後必須保留的最低現金緩衝"><Slider value={[floor]} min={60} max={90} step={1} onValueChange={(value) => onFloor(firstSliderValue(value))} /></Control><div className="rounded-lg border border-white/8 bg-white/3 p-4 text-xs"><div className="flex justify-between"><span className="text-slate-400">Treasury agents</span><span className="font-mono">30 fixed</span></div><div className="mt-3 flex justify-between"><span className="text-slate-400">Decision engine</span><span className="font-mono text-emerald-300">Deterministic</span></div><div className="mt-3 flex justify-between"><span className="text-slate-400">Execution</span><span className="font-mono">Simulation</span></div></div><Button onClick={onRun} disabled={running} className="h-11 w-full bg-cyan-300 font-semibold text-[#07111d] hover:bg-cyan-200">{running ? <Activity className="animate-pulse" /> : <Play />}{running ? 'Running 30 agents' : 'Run stress test'}</Button></div></aside></div></section>;
}

function IntentLedger({ intents }: { intents: PaymentIntent[] }) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState<'ALL' | 'HELD' | 'RELEASED'>('ALL');
  const visible = intents.filter((i) => (filter === 'ALL' || i.status === filter) && `${i.id} ${i.entity} ${i.destination}`.toLowerCase().includes(query.toLowerCase()));
  return <section><PageTitle eyebrow="Pre-signature observability" title="Intent Ledger" description="所有個別政策都 PASS；HerdBrake 額外檢查這些合法意圖合起來是否安全。" /><div className="panel overflow-hidden"><div className="flex flex-col gap-3 border-b border-white/8 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋 entity、destination、intent…" className="h-10 w-full rounded-md border border-white/10 bg-[#091421] pl-9 pr-3 text-sm outline-none focus:border-cyan-300/60" /></div><div className="flex gap-1">{(['ALL', 'HELD', 'RELEASED'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`}>{value}</button>)}</div></div><div className="overflow-x-auto"><table className="intent-table"><thead><tr><th>Intent</th><th>Entity</th><th>Action</th><th>Destination</th><th className="text-right">Amount</th><th>Individual</th><th>Status</th><th>Nonce</th></tr></thead><tbody>{visible.map((intent) => <tr key={intent.id}><td className="font-mono text-slate-300">{intent.id}</td><td>{intent.entity}{intent.critical && <span className="ml-2 text-[9px] font-bold text-amber-300">CRITICAL</span>}</td><td><span className={`inline-flex min-w-16 items-center justify-center gap-1 rounded px-2 py-1 text-[10px] font-bold ${actionStyles[intent.action]}`}>{actionMarks[intent.action]} {intent.action}</span></td><td className="font-mono">{intent.destination}</td><td className="text-right font-mono tabular-nums">{formatMoney(intent.amount)}</td><td><span className="text-emerald-300">✓ PASS</span></td><td><span className={intent.status === 'RELEASED' ? 'text-cyan-300' : 'text-rose-300'}>{intent.status}</span></td><td className="font-mono text-slate-500">{intent.nonce}</td></tr>)}</tbody></table></div><div className="border-t border-white/8 px-5 py-3 text-xs text-slate-500">Showing {visible.length} of {intents.length} intents · no PII · synthetic data</div></div></section>;
}

function EvidencePanel({ audit, replayBlocked, onReplay, onDownload, risk }: { audit: AuditEvent[]; replayBlocked: boolean; onReplay: () => void; onDownload: () => void; risk: ReturnType<typeof runRiskEngine> }) {
  return <section><PageTitle eyebrow="Audit-ready assurance" title="Evidence Pack" description="把「為何暫停、誰放行、如何防重播」整理成可下載且可重現的決策證據。" /><div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><div className="panel"><div className="panel-header"><div><p className="eyebrow">Immutable event trail</p><h2>Decision timeline</h2></div><History className="size-5 text-slate-500" /></div><div className="p-5 sm:p-6">{audit.map((event, index) => <div key={`${event.time}-${index}`} className="timeline-row"><span className={`timeline-dot ${event.tone === 'danger' ? 'bg-rose-400' : event.tone === 'safe' ? 'bg-emerald-400' : 'bg-slate-500'}`} /><div className="min-w-0 flex-1"><div className="flex flex-col justify-between gap-1 sm:flex-row"><h3 className="text-sm font-medium">{event.title}</h3><time className="font-mono text-[11px] text-slate-500">{event.time} CST</time></div><p className="mt-1 text-xs leading-5 text-slate-400">{event.detail}</p></div></div>)}</div></div><div className="space-y-5"><div className="panel p-5 sm:p-6"><p className="eyebrow">Policy attestation</p><div className="mt-4 grid grid-cols-2 gap-3"><EvidenceDatum label="Policy" value="v2.4.1" /><EvidenceDatum label="Rule hash" value="7F3A…9C21" /><EvidenceDatum label="Decision" value="HOLD" danger /><EvidenceDatum label="Reason" value={risk.reasonCode} /></div><div className="mt-4 rounded-lg border border-white/8 bg-white/3 p-3 text-xs leading-5 text-slate-400"><LockKeyhole className="mb-2 size-4 text-cyan-300" />LLM 只產生代理意圖；HOLD、分批放行與 nonce 驗證由外部確定性政策執行。</div></div><div className="panel p-5 sm:p-6"><p className="eyebrow">Adversarial check</p><h2 className="mt-1 text-lg font-semibold">Replay protection</h2><p className="mt-2 text-xs leading-5 text-slate-400">用已消耗的 nonce 重送付款意圖，驗證系統不會重複放款。</p><Button onClick={onReplay} disabled={replayBlocked} variant="outline" className="mt-4 w-full border-white/12 bg-transparent hover:bg-white/5">{replayBlocked ? <CheckCircle2 className="text-emerald-300" /> : <Fingerprint />}{replayBlocked ? 'REPLAY BLOCKED' : 'Run replay attack'}</Button></div><Button onClick={onDownload} className="h-11 w-full bg-white font-semibold text-[#07111d] hover:bg-slate-200"><Download />Download evidence JSON</Button></div></div></section>;
}

function BreakerDialog({ risk, count, prioritize, onCount, onPrioritize, onClose, onRelease }: { risk: ReturnType<typeof runRiskEngine>; count: number; prioritize: boolean; onCount: (n: number) => void; onPrioritize: (b: boolean) => void; onClose: () => void; onRelease: () => void }) {
  const candidates = (prioritize ? selectSafeRelease(risk.intents.filter((i) => i.status === 'HELD'), count) : risk.intents.filter((i) => i.status === 'HELD').slice(0, count).map((i) => i.id));
  const total = risk.intents.filter((i) => candidates.includes(i.id)).reduce((sum, i) => sum + i.amount, 0);
  return <dialog open className="fixed inset-0 z-50 grid h-full max-h-none w-full max-w-none place-items-center bg-[#030914]/80 p-4 text-white backdrop-blur-sm" aria-labelledby="breaker-title" onCancel={onClose}><div className="w-full max-w-xl overflow-hidden rounded-xl border border-white/12 bg-[#0d1826] shadow-2xl"><div className="flex items-start justify-between border-b border-white/8 p-5 sm:p-6"><div><p className="eyebrow">Human authorization</p><h2 id="breaker-title" className="mt-1 text-xl font-semibold">Staged release controls</h2><p className="mt-1 text-xs text-slate-400">先放行必要付款，每次放行後重新計算聚合風險。</p></div><button onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-white/6 hover:text-white" aria-label="關閉"><X className="size-4" /></button></div><div className="space-y-6 p-5 sm:p-6"><Control label="Release size" value={`${count} intents`} detail="MVP 單批上限 10 筆"><Slider value={[count]} min={1} max={10} step={1} onValueChange={(value) => onCount(firstSliderValue(value))} /></Control><div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/3 p-4"><div><p className="text-sm font-medium">Critical suppliers first</p><p className="mt-1 text-xs text-slate-500">同額度下優先維持營運不中斷</p></div><Switch checked={prioritize} onCheckedChange={onPrioritize} /></div><div className="grid grid-cols-3 gap-3"><EvidenceDatum label="Selected" value={String(candidates.length)} /><EvidenceDatum label="Batch value" value={formatMoney(total)} /><EvidenceDatum label="Remaining" value={String(Math.max(0, risk.intents.filter((i) => i.status === 'HELD').length - candidates.length))} /></div><div className="rounded-lg border border-amber-300/20 bg-amber-300/6 p-3 text-xs leading-5 text-amber-100"><CircleAlert className="mr-2 inline size-4" />這是模擬授權；正式環境仍需企業 RBAC、雙人覆核與支付服務商簽署。</div></div><div className="flex gap-3 border-t border-white/8 p-5 sm:px-6"><Button onClick={onClose} variant="outline" className="flex-1 border-white/12 bg-transparent">Cancel</Button><Button onClick={onRelease} className="flex-1 bg-cyan-300 font-semibold text-[#07111d] hover:bg-cyan-200"><ShieldCheck />Authorize stage</Button></div></div></dialog>;
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="mb-6"><p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-cyan-300">{eyebrow}</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p></div>; }
function Metric({ icon: Icon, label, value, tone = 'neutral' }: { icon: typeof Activity; label: string; value: string; tone?: 'neutral' | 'danger' | 'safe' }) { return <div className="metric-card"><div className="flex items-center justify-between"><span className="text-xs text-slate-400">{label}</span><Icon className="size-4 text-slate-500" /></div><div className={`mt-3 font-mono text-xl font-semibold tracking-tight ${tone === 'danger' ? 'text-rose-300' : tone === 'safe' ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</div></div>; }
function DecisionRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) { return <div className="flex items-center justify-between border-b border-white/7 pb-3"><span className="text-slate-400">{label}</span><span className={`font-mono font-medium ${emphasis ? 'text-rose-300' : 'text-slate-100'}`}>{value}</span></div>; }
function Control({ label, value, detail, children }: { label: string; value: string; detail: string; children: React.ReactNode }) { return <div><div className="mb-3 flex items-start justify-between gap-4"><div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div><span className="shrink-0 font-mono text-sm text-cyan-300">{value}</span></div>{children}</div>; }
function EvidenceDatum({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div className="rounded-lg border border-white/8 bg-white/3 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-1 break-all font-mono text-sm font-medium ${danger ? 'text-rose-300' : 'text-slate-200'}`}>{value}</p></div>; }
function BrandMark() { return <div className="relative grid size-9 place-items-center overflow-hidden rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-300"><ShieldCheck className="size-5" /><span className="absolute bottom-0 h-0.5 w-full bg-cyan-300" /></div>; }
function now(offsetSeconds = 0) { return new Date(Date.now() + offsetSeconds * 1000).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Taipei' }); }
function firstSliderValue(value: number | readonly number[]) { return Array.isArray(value) ? value[0] : value; }
