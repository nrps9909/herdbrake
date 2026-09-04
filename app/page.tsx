'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Building2,
  ClipboardCheck,
  Cpu,
  Download,
  FileCheck2,
  Fingerprint,
  Gauge,
  History,
  LockKeyhole,
  Network,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  AgentAction,
  PaymentIntent,
  ScenarioId,
  formatMoney,
  formatPct,
  runRiskEngine,
  scenarios,
  selectSafeRelease,
} from '@/lib/herdbrake';

type Tab = 'command' | 'lab' | 'ledger' | 'evidence';
type AuditEvent = {
  time: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'danger' | 'safe';
};
type ModelContext = {
  registerTool: (
    tool: unknown,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'command', label: 'Command Center', icon: Activity },
  { id: 'lab', label: 'Scenario Lab', icon: SlidersHorizontal },
  { id: 'ledger', label: 'Intent Ledger', icon: ClipboardCheck },
  { id: 'evidence', label: 'Evidence', icon: FileCheck2 },
];

const actionStyles: Record<AgentAction, string> = {
  PAY: 'bg-emerald-400 text-emerald-950',
  DELAY: 'bg-amber-300 text-amber-950',
  BUFFER: 'bg-sky-400 text-sky-950',
  TRANSFER: 'bg-rose-400 text-rose-950',
  USDC: 'bg-violet-400 text-violet-950',
};
const actionMarks: Record<AgentAction, string> = {
  PAY: '✓',
  DELAY: 'Ⅱ',
  BUFFER: '▣',
  TRANSFER: '→',
  USDC: '$',
};

export default function Home() {
  const [surface, setSurface] = useState<'site' | 'console'>('site');
  const [tab, setTab] = useState<Tab>('command');
  const [scenarioId, setScenarioId] = useState<ScenarioId>('stablecoin');
  const [severity, setSeverity] = useState(1);
  const [liquidityFloor, setLiquidityFloor] = useState(75);
  const [running, setRunning] = useState(false);
  const [breakerOpen, setBreakerOpen] = useState(false);
  const [releaseCount, setReleaseCount] = useState(5);
  const [prioritizeCritical, setPrioritizeCritical] = useState(true);
  const [authorizationReason, setAuthorizationReason] = useState(
    'Critical supplier continuity',
  );
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [releasedIds, setReleasedIds] = useState<string[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [remoteRisk, setRemoteRisk] = useState<ReturnType<
    typeof runRiskEngine
  > | null>(null);
  const [commitments, setCommitments] = useState<Record<string, string>>({});
  const [auditHead, setAuditHead] = useState<string | null>(null);
  const [backendState, setBackendState] = useState<
    'ready' | 'saving' | 'error'
  >('ready');
  const [replayBlocked, setReplayBlocked] = useState(false);
  const [notice, setNotice] = useState(
    '壓力測試完成：付款批次已在簽署前暫停。',
  );
  const [audit, setAudit] = useState<AuditEvent[]>([
    {
      time: '14:32:08',
      title: 'Shared breaker triggered',
      detail: 'HB-LIQ-003 · Aggregate liquidity floor breach',
      tone: 'danger',
    },
    {
      time: '14:32:07',
      title: '30 intents evaluated',
      detail: 'All individual policies passed; aggregate policy failed',
      tone: 'neutral',
    },
    {
      time: '14:32:05',
      title: 'Scenario signal received',
      detail: 'USDC/TWD liquidity feed · confidence 0.94',
      tone: 'neutral',
    },
  ]);

  const scenario =
    scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const localRisk = useMemo(
    () => runRiskEngine({ scenarioId, severity, liquidityFloor, releasedIds }),
    [scenarioId, severity, liquidityFloor, releasedIds],
  );
  const risk = remoteRisk ?? localRisk;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/runs', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 204) return;
        const latest = (await response.json()) as {
          runId?: string;
          scenarioId?: ScenarioId;
          severity?: number;
          risk?: ReturnType<typeof runRiskEngine>;
          commitments?: Record<string, string>;
          auditHead?: string | null;
        };
        if (response.ok && latest.runId && latest.risk) {
          setActiveRunId(latest.runId);
          setRemoteRisk(latest.risk);
          setCommitments(latest.commitments ?? {});
          setAuditHead(latest.auditHead ?? null);
          if (latest.scenarioId) setScenarioId(latest.scenarioId);
          if (typeof latest.severity === 'number') setSeverity(latest.severity);
          setLiquidityFloor(latest.risk.liquidityFloor);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setBackendState('error');
      });
    return () => controller.abort();
  }, []);

  const createPersistentRun = useCallback(
    async (nextId: ScenarioId, nextSeverity: number) => {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scenarioId: nextId,
          severity: nextSeverity,
          liquidityFloor,
        }),
      });
      const payload = (await response.json()) as {
        runId?: string;
        risk?: ReturnType<typeof runRiskEngine>;
        commitments?: Record<string, string>;
        auditHead?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.runId || !payload.risk)
        throw new Error(payload.error || 'Unable to persist stress run.');
      setActiveRunId(payload.runId);
      setRemoteRisk(payload.risk);
      setCommitments(payload.commitments ?? {});
      setAuditHead(payload.auditHead ?? null);
      return { runId: payload.runId, risk: payload.risk };
    },
    [liquidityFloor],
  );

  const runScenario = useCallback(
    async (nextId = scenarioId, nextSeverity = severity) => {
      setRunning(true);
      setBackendState('saving');
      setScenarioId(nextId);
      setSeverity(nextSeverity);
      setReleasedIds([]);
      setRemoteRisk(null);
      setReplayBlocked(false);
      try {
        await createPersistentRun(nextId, nextSeverity);
        const nextScenario =
          scenarios.find((item) => item.id === nextId) ?? scenarios[0];
        setAudit([
          {
            time: now(),
            title: 'Shared breaker triggered',
            detail: 'Aggregate policy re-evaluated before signing',
            tone: 'danger',
          },
          {
            time: now(-1),
            title: '30 intents evaluated',
            detail: 'Individual PASS · aggregate decision HOLD',
            tone: 'neutral',
          },
          {
            time: now(-2),
            title: 'Scenario signal received',
            detail: nextScenario.commonSignal,
            tone: 'neutral',
          },
        ]);
        setNotice(
          `${nextScenario.shortName}壓力測試已寫入安全後端：30 筆付款意圖與稽核鏈建立完成。`,
        );
        setBackendState('ready');
        setTab('command');
      } catch (error) {
        setBackendState('error');
        setNotice(
          `後端測試未完成：${error instanceof Error ? error.message : 'unknown error'}`,
        );
      } finally {
        setRunning(false);
      }
    },
    [createPersistentRun, scenarioId, severity],
  );

  const stageRelease = useCallback(
    async (count = releaseCount) => {
      if (!authorizationConfirmed || authorizationReason.trim().length < 8) {
        setNotice('請先填寫授權理由並確認這次模擬放行。');
        return;
      }
      setBackendState('saving');
      try {
        const persisted = activeRunId
          ? { runId: activeRunId }
          : await createPersistentRun(scenarioId, severity);
        const response = await fetch(
          `/api/runs/${encodeURIComponent(persisted.runId)}/release`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': `release:${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
              count,
              prioritizeCritical,
              confirmed: true,
              authorizationReason: authorizationReason.trim(),
            }),
          },
        );
        const payload = (await response.json()) as {
          releasedIntentIds?: string[];
          releasedCount?: number;
          error?: string;
        };
        if (!response.ok || !payload.releasedIntentIds)
          throw new Error(
            payload.error || 'Unable to authorize staged release.',
          );
        const refreshed = await fetch(
          `/api/runs/${encodeURIComponent(persisted.runId)}`,
          { cache: 'no-store' },
        );
        const run = (await refreshed.json()) as {
          risk?: ReturnType<typeof runRiskEngine>;
          commitments?: Record<string, string>;
          auditHead?: string | null;
          error?: string;
        };
        if (!refreshed.ok || !run.risk)
          throw new Error(run.error || 'Unable to refresh run state.');
        setRemoteRisk(run.risk);
        setCommitments(run.commitments ?? {});
        setAuditHead(run.auditHead ?? null);
        setReleasedIds(payload.releasedIntentIds);
        setAudit((current) => [
          {
            time: now(),
            title: `${payload.releasedCount ?? count} intents staged for release`,
            detail: `${authorizationReason.trim()} · ${prioritizeCritical ? 'critical suppliers first' : 'original queue order'} · authorization persisted`,
            tone: 'safe',
          },
          ...current,
        ]);
        setNotice(
          `已由後端安全放行 ${payload.releasedCount ?? count} 筆；其餘付款維持 HOLD。`,
        );
        setBackendState('ready');
        setAuthorizationConfirmed(false);
        setBreakerOpen(false);
      } catch (error) {
        setBackendState('error');
        setNotice(
          `放行失敗，所有付款維持 HOLD：${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    },
    [
      activeRunId,
      authorizationConfirmed,
      authorizationReason,
      createPersistentRun,
      prioritizeCritical,
      releaseCount,
      scenarioId,
      severity,
    ],
  );

  const runScenarioRef = useRef(runScenario);
  const riskRef = useRef(risk);

  useEffect(() => {
    runScenarioRef.current = runScenario;
    riskRef.current = risk;
  }, [risk, runScenario]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: 'run_herdbrake_stress_test',
        title: 'Run treasury stress test',
        description:
          'Run and persist a treasury-agent stress test, then open the visible HerdBrake command center.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scenarioId: { type: 'string', enum: scenarios.map((s) => s.id) },
            severity: { type: 'number', minimum: 0.1, maximum: 1 },
          },
          required: ['scenarioId', 'severity'],
        },
        execute: async (input: unknown) => {
          const { scenarioId: id, severity: level } =
            validateStressInput(input);
          setSurface('console');
          await runScenarioRef.current(id, level);
          return { scenarioId: id, severity: level, status: 'persisted' };
        },
      },
      {
        name: 'prepare_herdbrake_release',
        title: 'Prepare safe payment release',
        description:
          'Open the visible breaker controls for a human to review and authorize. This tool never releases payment intents by itself.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { count: { type: 'integer', minimum: 1, maximum: 10 } },
          required: ['count'],
        },
        execute: async (input: unknown) => {
          const count = validateReleaseInput(input);
          setSurface('console');
          setReleaseCount(count);
          setAuthorizationConfirmed(false);
          setBreakerOpen(true);
          return {
            proposedCount: count,
            authorization: 'human-required',
            persisted: false,
            fundsMoved: false,
          };
        },
      },
      {
        name: 'get_herdbrake_risk_state',
        title: 'Read aggregate risk state',
        description:
          'Read the current aggregate HerdBrake decision without changing it.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const current = riskRef.current;
          return {
            state: current.state,
            directionalAgreement: current.directionalAgreement,
            projectedBuffer: current.projectedBuffer,
            reasonCode: current.reasonCode,
          };
        },
      },
    ];
    tools.forEach((tool) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => undefined);
      } catch {
        /* unsupported preview context */
      }
    });
    return () => lifecycle.abort();
  }, []);

  async function blockReplay() {
    if (replayBlocked) return;
    setBackendState('saving');
    try {
      const persisted = activeRunId
        ? { runId: activeRunId }
        : await createPersistentRun(scenarioId, severity);
      const response = await fetch(
        `/api/runs/${encodeURIComponent(persisted.runId)}/replay`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as {
        blocked?: boolean;
        nonce?: string;
        error?: string;
      };
      if (!response.ok || !payload.blocked)
        throw new Error(payload.error || 'Replay probe did not complete.');
      setReplayBlocked(true);
      setAuditHead((payload as { auditHead?: string }).auditHead ?? auditHead);
      setBackendState('ready');
      setAudit((current) => [
        {
          time: now(),
          title: 'Replay attempt rejected',
          detail: `${payload.nonce} already registered · no duplicate execution`,
          tone: 'safe',
        },
        ...current,
      ]);
      setNotice('重播攻擊已由後端阻擋並寫入稽核雜湊鏈。');
    } catch (error) {
      setBackendState('error');
      setNotice(
        `重播測試失敗：${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async function downloadEvidence() {
    setBackendState('saving');
    try {
      const persisted = activeRunId
        ? { runId: activeRunId }
        : await createPersistentRun(scenarioId, severity);
      const response = await fetch(
        `/api/runs/${encodeURIComponent(persisted.runId)}/evidence`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Unable to create evidence pack.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `herdbrake-${persisted.runId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackendState('ready');
      setNotice('後端證據包已匯出，包含 commitment、完整稽核鏈與驗證結果。');
    } catch (error) {
      setBackendState('error');
      setNotice(
        `證據匯出失敗：${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  if (surface === 'site')
    return (
      <StartupSite
        onLaunch={() => {
          setSurface('console');
          if (!activeRunId) void runScenario();
        }}
      />
    );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#09111d]/92 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between gap-4 px-4 lg:px-8">
          <button
            onClick={() => setSurface('site')}
            className="flex items-center gap-3 text-left"
          >
            <BrandMark />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight">HerdBrake</span>
                <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                  TAIWAN LAB
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Agentic Payment Assurance
              </p>
            </div>
          </button>
          <nav
            className="hidden items-center gap-1 lg:flex"
            aria-label="產品功能"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`nav-tab ${tab === id ? 'nav-tab-active' : ''}`}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden items-center gap-2 sm:flex">
              <span
                className={`size-1.5 rounded-full ${backendState === 'error' ? 'bg-rose-400' : backendState === 'saving' ? 'animate-pulse bg-amber-300' : 'bg-emerald-400'}`}
              />
              {backendState === 'error'
                ? 'Backend error'
                : backendState === 'saving'
                  ? 'Persisting'
                  : 'D1 connected'}
            </span>
            <span className="rounded-md border border-white/10 px-2 py-1 font-mono">
              {activeRunId ? activeRunId.slice(0, 9) : 'TW-01'}
            </span>
          </div>
        </div>
        <nav
          className="flex overflow-x-auto border-t border-white/6 px-3 lg:hidden"
          aria-label="產品功能"
        >
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`mobile-tab ${tab === id ? 'mobile-tab-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-8 lg:py-7">
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-cyan-300/15 bg-cyan-300/6 px-3.5 py-2.5 text-xs text-cyan-100">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-cyan-300" />
            {notice}
          </span>
          <button
            onClick={() => setNotice('系統就緒：所有金流維持在模擬環境。')}
            aria-label="關閉通知"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {tab === 'command' && (
          <CommandCenter
            risk={risk}
            scenario={scenario}
            running={running}
            onRun={() => runScenario()}
            onOpenBreaker={() => {
              setAuthorizationConfirmed(false);
              setBreakerOpen(true);
            }}
            onNavigate={setTab}
          />
        )}
        {tab === 'lab' && (
          <ScenarioLab
            selected={scenarioId}
            severity={severity}
            floor={liquidityFloor}
            running={running}
            onSelect={setScenarioId}
            onSeverity={setSeverity}
            onFloor={setLiquidityFloor}
            onRun={() => runScenario()}
          />
        )}
        {tab === 'ledger' && (
          <IntentLedger intents={risk.intents} commitments={commitments} />
        )}
        {tab === 'evidence' && (
          <EvidencePanel
            audit={audit}
            replayBlocked={replayBlocked}
            onReplay={blockReplay}
            onDownload={downloadEvidence}
            risk={risk}
            auditHead={auditHead}
            commitmentCount={Object.keys(commitments).length}
          />
        )}
      </div>
      <footer className="mx-auto flex max-w-[1500px] flex-col gap-2 border-t border-white/8 px-4 py-5 text-[11px] text-slate-500 sm:flex-row sm:justify-between lg:px-8">
        <span>HerdBrake Taiwan · Hackathon demonstrator</span>
        <span>
          Simulation only · No custody · No autonomous execution · Human
          approval required
        </span>
      </footer>
      {breakerOpen && (
        <BreakerDialog
          risk={risk}
          count={releaseCount}
          prioritize={prioritizeCritical}
          authorizationReason={authorizationReason}
          confirmed={authorizationConfirmed}
          busy={backendState === 'saving'}
          onCount={setReleaseCount}
          onPrioritize={setPrioritizeCritical}
          onReason={setAuthorizationReason}
          onConfirmed={setAuthorizationConfirmed}
          onClose={() => setBreakerOpen(false)}
          onRelease={() => stageRelease()}
        />
      )}
    </main>
  );
}

function StartupSite({ onLaunch }: { onLaunch: () => void }) {
  return (
    <main className="startup-site min-h-screen bg-[#f4f3ee] text-[#111714]">
      <header className="startup-nav">
        <div className="startup-container flex h-[76px] items-center justify-between">
          <a
            href="#top"
            className="flex items-center gap-2.5 font-semibold tracking-[-.02em]"
            aria-label="HerdBrake 首頁"
          >
            <StartupMark />
            <span>HerdBrake</span>
          </a>
          <nav
            className="hidden items-center gap-8 text-[13px] font-medium text-[#56605a] lg:flex"
            aria-label="網站導覽"
          >
            <a href="#problem">Why HerdBrake</a>
            <a href="#platform">Platform</a>
            <a href="#engineering">Engineering</a>
            <a href="#taiwan">Taiwan readiness</a>
            <a href="#research">Research</a>
          </nav>
          <button
            onClick={onLaunch}
            className="startup-button startup-button-dark"
          >
            Open live product <ArrowRight />
          </button>
        </div>
      </header>

      <section id="top" className="overflow-hidden border-b border-[#cfd3cb]">
        <div className="startup-container grid min-h-[720px] items-center gap-14 py-20 lg:grid-cols-[.88fr_1.12fr] lg:py-24">
          <div className="relative z-10">
            <div className="startup-kicker">
              <span className="size-2 rounded-full bg-[#ff5938]" />
              Pre-execution safety for agentic finance
            </div>
            <h1 className="mt-7 max-w-[720px] text-[clamp(3.25rem,7vw,6.9rem)] font-semibold leading-[.89] tracking-[-.072em]">
              Stop the herd
              <br />
              <span className="text-[#ff5938]">before money moves.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-8 text-[#4e5852]">
              AI agents can make individually valid decisions that become
              dangerous together. HerdBrake sees the batch, holds it before
              signing, and gives treasury teams a controlled path forward.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={onLaunch}
                className="startup-button startup-button-accent"
              >
                Run the live scenario <ArrowRight />
              </button>
              <a
                href="#platform"
                className="startup-button startup-button-light"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-[#69736d]">
              <ShieldCheck className="size-4" />
              Synthetic funds · deterministic controls · human authorization
            </p>
          </div>
          <HeroProductPreview onLaunch={onLaunch} />
        </div>
      </section>

      <section className="border-b border-[#cfd3cb] bg-[#111714] text-white">
        <div className="startup-container grid divide-y divide-white/15 py-1 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <ProofStat value="30 / 30" label="Individual policies pass" />
          <ProofStat value="24" label="Agents choose one action" />
          <ProofStat value="1" label="Shared breaker stops the batch" />
        </div>
      </section>

      <section id="problem" className="startup-section">
        <div className="startup-container">
          <SectionLead
            index="01"
            eyebrow="The blind spot"
            title="Your policy engine checks transactions. Who checks the system?"
            body="Traditional controls ask whether one agent is allowed to pay. HerdBrake asks the harder question: if every allowed action executes at once, does the organization remain safe?"
          />
          <div className="mt-20 grid border-y border-[#c9cec6] lg:grid-cols-3 lg:divide-x lg:divide-[#c9cec6]">
            <ProblemColumn
              number="01"
              title="Individually compliant"
              body="Each agent stays within its own limit, approved destination, and assigned authority."
            />
            <ProblemColumn
              number="02"
              title="Collectively correlated"
              body="A common model, signal, or shock pushes independent agents toward the same defensive move."
            />
            <ProblemColumn
              number="03"
              title="Operationally dangerous"
              body="The combined outflow breaches liquidity floors before legacy monitoring sees the pattern."
              accent
            />
          </div>
        </div>
      </section>

      <section id="platform" className="startup-section bg-[#e7e9e2]">
        <div className="startup-container">
          <SectionLead
            index="02"
            eyebrow="The platform"
            title="One control plane between intent and execution."
            body="HerdBrake turns emerging agent-herding research into an operational workflow that treasury and risk teams can use before deployment and during execution."
          />
          <div className="mt-16 overflow-hidden border border-[#bbc1b8] bg-[#f7f7f3]">
            <div className="grid lg:grid-cols-[320px_1fr]">
              <div className="border-b border-[#bbc1b8] p-6 lg:border-b-0 lg:border-r lg:p-8">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#78817b]">
                  Decision sequence
                </p>
                <div className="mt-8 space-y-1">
                  {[
                    'Observe canonical intents',
                    'Measure fleet correlation',
                    'Hold before signing',
                    'Release in safe stages',
                  ].map((text, index) => (
                    <div
                      key={text}
                      className={`flex items-center gap-4 border-l-2 px-4 py-4 text-sm ${index === 2 ? 'border-[#ff5938] bg-[#ff5938]/7 font-semibold text-[#111714]' : 'border-[#c6cbc3] text-[#59635d]'}`}
                    >
                      <span className="font-mono text-[11px] text-[#909890]">
                        0{index + 1}
                      </span>
                      {text}
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-6 sm:p-9 lg:p-12">
                <PlatformDiagram />
                <div className="mt-9 grid gap-8 border-t border-[#d1d5cd] pt-8 sm:grid-cols-3">
                  <MiniFeature
                    icon={Radar}
                    title="Herd detection"
                    body="Direction, destination and timing concentration."
                  />
                  <MiniFeature
                    icon={Pause}
                    title="Shared breaker"
                    body="One deterministic decision across the batch."
                  />
                  <MiniFeature
                    icon={TimerReset}
                    title="Staged release"
                    body="Prioritize essentials, then recompute risk."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="startup-section bg-[#111714] text-white">
        <div className="startup-container">
          <div className="grid gap-16 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <span className="section-index border-white/20 text-white/60">
                03
              </span>
              <p className="mt-8 text-xs font-semibold uppercase tracking-[.18em] text-[#ff8067]">
                Designed to intervene
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-.045em] sm:text-6xl">
                Not another AI wallet.
                <br />
                Not another research dashboard.
              </h2>
            </div>
            <div className="self-end">
              <p className="max-w-xl text-lg leading-8 text-white/60">
                The product distinction is not “many agents.” It is the
                combination of pre-execution visibility, aggregate safety
                policy, and an intervention that changes whether funds can move.
              </p>
              <div className="mt-10 grid border-y border-white/15 sm:grid-cols-3 sm:divide-x sm:divide-white/15">
                <DarkFeature label="Observe" value="Unsigned intent" />
                <DarkFeature label="Decide" value="Aggregate policy" />
                <DarkFeature label="Intervene" value="Hold + release" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="engineering" className="startup-section bg-white">
        <div className="startup-container">
          <SectionLead
            index="04"
            eyebrow="Live engineering"
            title="The demo is backed by a real assurance service."
            body="Every stress run, intent, release and replay probe is processed server-side and persisted. The browser is a control surface—not the source of truth."
          />
          <div className="mt-16 grid border-y border-[#c9cec6] md:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[#c9cec6]">
            <EngineeringProof
              label="Persistence"
              value="Cloudflare D1"
              body="Runs, intents, audit events and idempotency records survive reloads."
            />
            <EngineeringProof
              label="Integrity"
              value="SHA-256 chain"
              body="Canonical commitments and linked audit hashes reveal tampering."
            />
            <EngineeringProof
              label="Execution safety"
              value="Idempotent release"
              body="Repeated authorization requests return the prior result."
            />
            <EngineeringProof
              label="Replay defense"
              value="Unique nonce"
              body="Duplicate intent nonces are rejected before execution."
            />
          </div>
          <div className="mt-8 flex flex-col justify-between gap-6 bg-[#111714] px-6 py-6 text-white sm:flex-row sm:items-center sm:px-8">
            <div className="flex items-center gap-4">
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5fd2a5] opacity-40" />
                <span className="relative inline-flex size-3 rounded-full bg-[#5fd2a5]" />
              </span>
              <div>
                <p className="text-sm font-semibold">Assurance API</p>
                <p className="mt-1 font-mono text-[10px] text-white/45">
                  D1 · Worker runtime · no real funds
                </p>
              </div>
            </div>
            <div className="flex gap-5 text-xs">
              <a
                className="border-b border-white/40 pb-1 hover:border-[#ff8067] hover:text-[#ff8067]"
                href="/api/health"
                target="_blank"
              >
                Live health ↗
              </a>
              <a
                className="border-b border-white/40 pb-1 hover:border-[#ff8067] hover:text-[#ff8067]"
                href="/api/openapi"
                target="_blank"
              >
                OpenAPI 3.1 ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="taiwan" className="startup-section">
        <div className="startup-container">
          <SectionLead
            index="05"
            eyebrow="Taiwan readiness"
            title="Built for a responsible pilot, not regulatory theatre."
            body="The first deployment sits inside one enterprise or financial institution, uses synthetic or non-custodial payment intents, and keeps final authorization with accountable people."
          />
          <div className="mt-16 grid gap-px overflow-hidden border border-[#c9cec6] bg-[#c9cec6] md:grid-cols-2">
            <ReadinessItem
              icon={Building2}
              title="Single-organization pilot"
              body="Start with multiple departments, subsidiaries, or treasury agents under one governance perimeter."
            />
            <ReadinessItem
              icon={Scale}
              title="Regulatory boundary first"
              body="No custody or money transmission in the MVP. Regulated activity requires licensed partners or an approved experiment."
            />
            <ReadinessItem
              icon={Cpu}
              title="AI governance evidence"
              body="Inventory models, preserve decision logs, test failure modes, and keep deterministic controls outside the model."
            />
            <ReadinessItem
              icon={LockKeyhole}
              title="Human accountability"
              body="RBAC, dual control, critical-supplier priority, and explicit authorization before any signing step."
            />
          </div>
          <div className="mt-8 flex flex-col justify-between gap-5 border-t border-[#c9cec6] pt-6 text-sm text-[#5d6660] lg:flex-row lg:items-center">
            <p className="max-w-3xl">
              Reference path: Taiwan FSC AI guidance for financial institutions
              and the FinTech Regulatory Sandbox framework. These are design
              inputs—not a claim of approval or certification.
            </p>
            <div className="flex shrink-0 gap-5">
              <a
                className="startup-text-link"
                href="https://law.fsc.gov.tw/LawContent.aspx?id=GL003920"
                target="_blank"
                rel="noreferrer"
              >
                AI guidance ↗
              </a>
              <a
                className="startup-text-link"
                href="https://law.fsc.gov.tw/LawContent.aspx?id=GL002360"
                target="_blank"
                rel="noreferrer"
              >
                Sandbox law ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        id="research"
        className="startup-section border-y border-[#cfd3cb] bg-white"
      >
        <div className="startup-container grid gap-14 lg:grid-cols-[.75fr_1.25fr]">
          <div>
            <span className="section-index">06</span>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[.18em] text-[#ff5938]">
              Why now
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-.04em]">
              Agents are reaching the execution layer.
            </h2>
          </div>
          <div className="divide-y divide-[#d8dcd5] border-y border-[#d8dcd5]">
            <ResearchRow
              source="BIS · Project Logos"
              title="LLM agents can amplify correlated financial decisions."
              tag="Research signal"
              href="https://www.bis.org/project/logos"
            />
            <ResearchRow
              source="Industry direction"
              title="Payment platforms are building policy controls for agentic transactions."
              tag="Market signal"
              href="https://www.fireblocks.com/products/agentic-payments"
            />
            <ResearchRow
              source="HerdBrake thesis"
              title="The missing layer is aggregate intervention before execution."
              tag="Product gap"
            />
          </div>
        </div>
      </section>

      <section className="startup-section bg-[#ff5938] text-[#111714]">
        <div className="startup-container grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em]">
              Live product demonstrator
            </p>
            <h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[.97] tracking-[-.055em] sm:text-7xl">
              See thirty compliant agents become one unsafe batch.
            </h2>
          </div>
          <button
            onClick={onLaunch}
            className="startup-button startup-button-dark min-w-52"
          >
            Open control plane <ArrowRight />
          </button>
        </div>
      </section>

      <footer className="bg-[#111714] text-white">
        <div className="startup-container grid gap-12 py-14 md:grid-cols-[1fr_auto_auto]">
          <div>
            <div className="flex items-center gap-2.5 text-lg font-semibold">
              <StartupMark inverted />
              HerdBrake
            </div>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">
              Agentic Treasury Assurance for the moment between decision and
              execution.
            </p>
          </div>
          <div>
            <p className="footer-label">Product</p>
            <div className="footer-links">
              <button onClick={onLaunch}>Live demo</button>
              <a href="#platform">Platform</a>
              <a href="#taiwan">Taiwan readiness</a>
            </div>
          </div>
          <div>
            <p className="footer-label">Status</p>
            <div className="footer-links">
              <span>Hackathon demonstrator</span>
              <span>Simulation only</span>
              <span>Human approval required</span>
            </div>
          </div>
        </div>
        <div className="startup-container flex flex-col gap-2 border-t border-white/10 py-6 text-[11px] text-white/40 sm:flex-row sm:justify-between">
          <span>© 2026 HerdBrake Taiwan</span>
          <span>
            Research prototype · Not a bank, custodian, or licensed payment
            institution
          </span>
        </div>
      </footer>
    </main>
  );
}

function HeroProductPreview({ onLaunch }: { onLaunch: () => void }) {
  const nodes = Array.from({ length: 30 }, (_, i) => i < 24);
  return (
    <button
      onClick={onLaunch}
      className="product-preview group text-left"
      aria-label="開啟 HerdBrake 互動產品"
    >
      <div className="preview-top">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#1e5d49]" />
          <span>HerdBrake Control</span>
        </div>
        <span>Batch FX-042</span>
      </div>
      <div className="grid lg:grid-cols-[1fr_210px]">
        <div className="p-6 sm:p-8">
          <div className="flex items-end justify-between border-b border-[#d8dcd5] pb-5">
            <div>
              <p className="preview-label">Directional agreement</p>
              <p className="mt-2 text-4xl font-semibold tracking-[-.05em]">
                82%
              </p>
            </div>
            <span className="preview-status">HOLD</span>
          </div>
          <div className="mt-8">
            <div className="flex justify-between text-[10px] font-semibold uppercase tracking-[.12em] text-[#757e78]">
              <span>30 treasury agents</span>
              <span>Pre-signature</span>
            </div>
            <div className="mt-5 grid grid-cols-10 gap-2">
              {nodes.map((danger, index) => (
                <span
                  key={index}
                  className={`aspect-square rounded-[3px] border ${danger ? 'border-[#ff5938] bg-[#ff5938]' : 'border-[#8c9690] bg-transparent'}`}
                />
              ))}
            </div>
          </div>
          <div className="mt-8 flex items-center justify-between text-xs text-[#606963]">
            <span>
              Projected buffer{' '}
              <strong className="ml-1 text-[#111714]">74%</strong>
            </span>
            <span className="flex items-center gap-1 font-semibold text-[#111714]">
              Inspect decision{' '}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
            </span>
          </div>
        </div>
        <div className="border-t border-[#d8dcd5] bg-[#eceee8] p-6 lg:border-l lg:border-t-0">
          <p className="preview-label">Reason code</p>
          <p className="mt-2 font-mono text-sm font-semibold">HB-LIQ-003</p>
          <div className="mt-8 space-y-4">
            <PreviewRow label="Individual policies" value="30 PASS" safe />
            <PreviewRow label="Same action" value="24 / 30" />
            <PreviewRow label="Outflow" value="US$8.4M" />
            <PreviewRow label="Execution" value="NOT SIGNED" />
          </div>
        </div>
      </div>
    </button>
  );
}

function StartupMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <span
      className={`grid size-8 place-items-center border ${inverted ? 'border-white/30' : 'border-[#111714]'}`}
    >
      <span
        className={`h-3.5 w-1.5 border-x-2 ${inverted ? 'border-[#ff8067]' : 'border-[#ff5938]'}`}
      />
    </span>
  );
}
function ProofStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-6 py-8 sm:px-9">
      <p className="font-mono text-2xl font-semibold text-[#ff8067]">{value}</p>
      <p className="mt-1 text-sm text-white/55">{label}</p>
    </div>
  );
}
function SectionLead({
  index,
  eyebrow,
  title,
  body,
}: {
  index: string;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[140px_1fr_1fr] lg:items-start">
      <span className="section-index">{index}</span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#ff5938]">
          {eyebrow}
        </p>
        <h2 className="mt-4 text-4xl font-semibold leading-[1.03] tracking-[-.045em] sm:text-5xl">
          {title}
        </h2>
      </div>
      <p className="max-w-xl text-base leading-7 text-[#5a645e] lg:pt-8">
        {body}
      </p>
    </div>
  );
}
function ProblemColumn({
  number,
  title,
  body,
  accent = false,
}: {
  number: string;
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`px-0 py-8 lg:px-8 lg:py-10 ${accent ? 'text-[#c83a21]' : ''}`}
    >
      <span className="font-mono text-xs opacity-55">{number}</span>
      <h3 className="mt-12 text-2xl font-semibold tracking-[-.03em]">
        {title}
      </h3>
      <p
        className={`mt-3 text-sm leading-6 ${accent ? 'text-[#9f402d]' : 'text-[#606963]'}`}
      >
        {body}
      </p>
    </div>
  );
}
function MiniFeature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Radar;
  title: string;
  body: string;
}) {
  return (
    <div>
      <Icon className="size-5 text-[#ff5938]" />
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-[#69736d]">{body}</p>
    </div>
  );
}
function PlatformDiagram() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="diagram-label">Agent intents</span>
        <span className="diagram-label">Execution gateway</span>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 15 }, (_, i) => (
            <span
              key={i}
              className={`h-7 border ${i < 11 ? 'border-[#ff5938] bg-[#ff5938]/15' : 'border-[#9ca49d]'}`}
            />
          ))}
        </div>
        <ArrowRight className="size-5 text-[#8a938d]" />
        <div className="border-2 border-[#ff5938] bg-white p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#ff5938]">
            Shared breaker
          </p>
          <p className="mt-2 text-2xl font-semibold">HOLD</p>
          <p className="mt-5 border-t border-[#d8dcd5] pt-3 font-mono text-[10px] text-[#707a73]">
            POLICY / HB-LIQ-003
          </p>
        </div>
      </div>
    </div>
  );
}
function DarkFeature({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-6 sm:px-6 first:pl-0">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/35">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}
function ReadinessItem({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Building2;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-[#f4f3ee] p-7 sm:p-9">
      <Icon className="size-5 text-[#ff5938]" />
      <h3 className="mt-10 text-xl font-semibold tracking-[-.025em]">
        {title}
      </h3>
      <p className="mt-3 max-w-lg text-sm leading-6 text-[#606963]">{body}</p>
    </div>
  );
}
function EngineeringProof({
  label,
  value,
  body,
}: {
  label: string;
  value: string;
  body: string;
}) {
  return (
    <div className="py-8 md:px-6 lg:px-7">
      <p className="font-mono text-[10px] uppercase tracking-[.14em] text-[#818983]">
        {label}
      </p>
      <h3 className="mt-8 text-xl font-semibold tracking-[-.03em]">{value}</h3>
      <p className="mt-3 text-xs leading-5 text-[#68716b]">{body}</p>
    </div>
  );
}
function ResearchRow({
  source,
  title,
  tag,
  href,
}: {
  source: string;
  title: string;
  tag: string;
  href?: string;
}) {
  const content = (
    <>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#7b847e]">
          {source}
        </p>
        <p className="mt-2 text-base font-medium">{title}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] uppercase text-[#ff5938]">
        {tag}
      </span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="research-row">
      {content}
    </a>
  ) : (
    <div className="research-row">{content}</div>
  );
}
function PreviewRow({
  label,
  value,
  safe = false,
}: {
  label: string;
  value: string;
  safe?: boolean;
}) {
  return (
    <div className="flex justify-between border-b border-[#d1d5cd] pb-3 text-[11px]">
      <span className="text-[#747d77]">{label}</span>
      <span
        className={`font-mono font-semibold ${safe ? 'text-[#1e5d49]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function CommandCenter({
  risk,
  scenario,
  running,
  onRun,
  onOpenBreaker,
  onNavigate,
}: {
  risk: ReturnType<typeof runRiskEngine>;
  scenario: (typeof scenarios)[number];
  running: boolean;
  onRun: () => void;
  onOpenBreaker: () => void;
  onNavigate: (tab: Tab) => void;
}) {
  const held = risk.intents.filter((i) => i.status === 'HELD').length;
  const batchId = `#${scenario.id.toUpperCase().replace('-', '')}-042`;
  const reasonLabel =
    risk.reasonCode === 'HB-LIQ-003'
      ? 'Aggregate buffer breach'
      : risk.reasonCode === 'HB-HERD-002'
        ? 'Correlated agent behavior'
        : risk.reasonCode === 'HB-CONC-001'
          ? 'Destination concentration'
          : 'Aggregate controls passed';
  return (
    <>
      <section className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-cyan-300">
            <Activity className="size-3.5" /> Live decision surface
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {scenario.name}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            30 個財務代理各自合規，但同步決策可能擊穿集團流動性；HerdBrake
            在付款簽署前攔截。
          </p>
        </div>
        <Button
          onClick={onRun}
          disabled={running}
          size="lg"
          className="h-10 bg-cyan-300 px-4 font-semibold text-[#07111d] hover:bg-cyan-200"
        >
          {running ? <Activity className="animate-pulse" /> : <RotateCcw />}
          {running ? 'Recomputing risk' : 'Rerun scenario'}
        </Button>
      </section>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={Network}
          label="Directional agreement"
          value={formatPct(risk.directionalAgreement)}
          tone="danger"
        />
        <Metric
          icon={Gauge}
          label="Destination concentration"
          value={formatPct(risk.destinationConcentration)}
          tone="danger"
        />
        <Metric
          icon={Banknote}
          label="Proposed outflow"
          value={formatMoney(risk.proposedOutflow)}
        />
        <Metric
          icon={Activity}
          label="Projected buffer"
          value={formatPct(risk.projectedBuffer)}
          tone={risk.projectedBuffer < risk.liquidityFloor ? 'danger' : 'safe'}
        />
        <Metric
          icon={CircleAlert}
          label="Risk state"
          value={risk.state}
          tone={risk.state === 'CRITICAL' ? 'danger' : 'safe'}
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.75fr)]">
        <div className="panel min-w-0">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Fleet correlation</p>
              <h2>Herd Map</h2>
            </div>
            <div className="hidden flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-slate-400 sm:flex">
              {Object.keys(actionStyles).map((action) => (
                <span key={action} className="flex items-center gap-1.5">
                  <span
                    className={`grid size-3 place-items-center rounded-sm text-[8px] ${actionStyles[action as AgentAction]}`}
                  >
                    {actionMarks[action as AgentAction]}
                  </span>
                  {action}
                </span>
              ))}
            </div>
          </div>
          <div className="relative overflow-hidden p-5 sm:p-7">
            <div className="herd-grid" aria-label="30 treasury agent decisions">
              {risk.intents.map((intent, index) => (
                <button
                  key={intent.id}
                  className={`agent-node ${actionStyles[intent.action]} ${intent.status === 'RELEASED' ? 'ring-2 ring-white' : ''}`}
                  aria-label={`${intent.entity}: ${intent.action}, ${intent.status}`}
                  title={`${intent.id} · ${intent.action} · ${intent.status}`}
                  style={{ animationDelay: `${index * 14}ms` }}
                >
                  <span>{actionMarks[intent.action]}</span>
                  <span className="sr-only">{index + 1}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-2 border-t border-white/8 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <span>Common signal: {scenario.commonSignal}</span>
              <span className="font-mono text-slate-500">
                POLICY v2.4.1 · deterministic
              </span>
            </div>
          </div>
        </div>
        <aside
          className={`panel overflow-hidden ${risk.state === 'CRITICAL' ? 'border-rose-400/35' : 'border-emerald-400/30'}`}
        >
          <div
            className={`h-1 ${risk.state === 'CRITICAL' ? 'bg-rose-400' : 'bg-emerald-400'}`}
          />
          <div className="p-5 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Pre-execution decision</p>
                <h2 className="mt-1 text-xl font-semibold">Batch {batchId}</h2>
              </div>
              <span
                className={`status-badge ${risk.state === 'CRITICAL' ? 'status-danger' : 'status-safe'}`}
              >
                {risk.state === 'CRITICAL' ? <Pause /> : <ShieldCheck />}
                {risk.state === 'CRITICAL' ? 'HOLD' : risk.state}
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <DecisionRow
                label="Intents received"
                value={String(risk.intents.length)}
              />
              <DecisionRow
                label="Same defensive action"
                value={`${risk.leadingCount} agents`}
                emphasis={risk.directionalAgreement >= 70}
              />
              <DecisionRow
                label="Liquidity floor"
                value={`${Math.round(risk.projectedBuffer - risk.liquidityFloor)}% variance`}
                emphasis={risk.projectedBuffer < risk.liquidityFloor}
              />
              <DecisionRow
                label="Execution status"
                value={`${held} held · ${risk.intents.length - held} released`}
              />
            </div>
            <div className="mt-6 rounded-lg border border-rose-400/25 bg-rose-400/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">
                Reason code
              </p>
              <p className="mt-1.5 text-sm font-medium">
                {risk.reasonCode} · {reasonLabel}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                每筆付款皆通過個別限額，但仍須通過聚合控制。判斷來自可驗證規則，不由
                LLM 自行批准。
              </p>
            </div>
            <Button
              onClick={onOpenBreaker}
              disabled={held === 0}
              className="mt-5 h-10 w-full justify-between bg-white text-[#07111d] hover:bg-slate-200"
            >
              Open breaker controls <ArrowRight />
            </Button>
            <button
              onClick={() => onNavigate('ledger')}
              className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-slate-400 hover:text-white"
            >
              Inspect canonical intents <ChevronRight className="size-3" />
            </button>
          </div>
        </aside>
      </section>
    </>
  );
}

function ScenarioLab({
  selected,
  severity,
  floor,
  running,
  onSelect,
  onSeverity,
  onFloor,
  onRun,
}: {
  selected: ScenarioId;
  severity: number;
  floor: number;
  running: boolean;
  onSelect: (id: ScenarioId) => void;
  onSeverity: (n: number) => void;
  onFloor: (n: number) => void;
  onRun: () => void;
}) {
  return (
    <section>
      <PageTitle
        eyebrow="Deployment rehearsal"
        title="Scenario Lab"
        description="上線前先讓 30 個代理遭遇相同衝擊，檢查政策是否會把個別合理決策放大成群體風險。"
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scenarios.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`scenario-card ${selected === item.id ? 'scenario-card-active' : ''}`}
            >
              <div className="mb-5 flex items-start justify-between">
                <span className="scenario-icon">{item.icon}</span>
                {selected === item.id && (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                    <Check className="size-3" />
                    Selected
                  </span>
                )}
              </div>
              <h3>{item.shortName}</h3>
              <p>{item.description}</p>
              <span className="mt-4 block font-mono text-[10px] text-slate-500">
                SIGNAL · {item.commonSignal}
              </span>
            </button>
          ))}
        </div>
        <aside className="panel h-fit p-5 sm:p-6">
          <p className="eyebrow">Test configuration</p>
          <h2 className="mt-1 text-lg font-semibold">Guardrail controls</h2>
          <div className="mt-6 space-y-7">
            <Control
              label="Shock severity"
              value={`${Math.round(severity * 100)}%`}
              detail="影響 agents 同步採取防禦行動的比例"
            >
              <Slider
                value={[severity * 100]}
                min={10}
                max={100}
                step={10}
                onValueChange={(value) =>
                  onSeverity(firstSliderValue(value) / 100)
                }
              />
            </Control>
            <Control
              label="Liquidity floor"
              value={`${floor}%`}
              detail="集團付款後必須保留的最低現金緩衝"
            >
              <Slider
                value={[floor]}
                min={60}
                max={90}
                step={1}
                onValueChange={(value) => onFloor(firstSliderValue(value))}
              />
            </Control>
            <div className="rounded-lg border border-white/8 bg-white/3 p-4 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Treasury agents</span>
                <span className="font-mono">30 fixed</span>
              </div>
              <div className="mt-3 flex justify-between">
                <span className="text-slate-400">Decision engine</span>
                <span className="font-mono text-emerald-300">
                  Deterministic
                </span>
              </div>
              <div className="mt-3 flex justify-between">
                <span className="text-slate-400">Execution</span>
                <span className="font-mono">Simulation</span>
              </div>
            </div>
            <Button
              onClick={onRun}
              disabled={running}
              className="h-11 w-full bg-cyan-300 font-semibold text-[#07111d] hover:bg-cyan-200"
            >
              {running ? <Activity className="animate-pulse" /> : <Play />}
              {running ? 'Running 30 agents' : 'Run stress test'}
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function IntentLedger({
  intents,
  commitments,
}: {
  intents: PaymentIntent[];
  commitments: Record<string, string>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'HELD' | 'RELEASED'>('ALL');
  const visible = intents.filter(
    (i) =>
      (filter === 'ALL' || i.status === filter) &&
      `${i.id} ${i.entity} ${i.destination}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section>
      <PageTitle
        eyebrow="Pre-signature observability"
        title="Intent Ledger"
        description="所有個別政策都 PASS；HerdBrake 額外檢查這些合法意圖合起來是否安全。"
      />
      <div className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-white/8 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋 entity、destination、intent…"
              className="h-10 w-full rounded-md border border-white/10 bg-[#091421] pl-9 pr-3 text-sm outline-none focus:border-cyan-300/60"
            />
          </div>
          <div className="flex gap-1">
            {(['ALL', 'HELD', 'RELEASED'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="intent-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Entity</th>
                <th>Action</th>
                <th>Destination</th>
                <th className="text-right">Amount</th>
                <th>Individual</th>
                <th>Status</th>
                <th>Nonce</th>
                <th>Commitment</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((intent) => (
                <tr key={intent.id}>
                  <td className="font-mono text-slate-300">{intent.id}</td>
                  <td>
                    {intent.entity}
                    {intent.critical && (
                      <span className="ml-2 text-[9px] font-bold text-amber-300">
                        CRITICAL
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`inline-flex min-w-16 items-center justify-center gap-1 rounded px-2 py-1 text-[10px] font-bold ${actionStyles[intent.action]}`}
                    >
                      {actionMarks[intent.action]} {intent.action}
                    </span>
                  </td>
                  <td className="font-mono">{intent.destination}</td>
                  <td className="text-right font-mono tabular-nums">
                    {formatMoney(intent.amount)}
                  </td>
                  <td>
                    <span className="text-emerald-300">✓ PASS</span>
                  </td>
                  <td>
                    <span
                      className={
                        intent.status === 'RELEASED'
                          ? 'text-cyan-300'
                          : 'text-rose-300'
                      }
                    >
                      {intent.status}
                    </span>
                  </td>
                  <td className="font-mono text-slate-500">{intent.nonce}</td>
                  <td className="font-mono text-slate-500">
                    {commitments[intent.id]
                      ? `${commitments[intent.id].slice(0, 10)}…`
                      : 'pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-white/8 px-5 py-3 text-xs text-slate-500">
          Showing {visible.length} of {intents.length} intents ·{' '}
          {Object.keys(commitments).length} server commitments · no PII
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({
  audit,
  replayBlocked,
  onReplay,
  onDownload,
  risk,
  auditHead,
  commitmentCount,
}: {
  audit: AuditEvent[];
  replayBlocked: boolean;
  onReplay: () => void;
  onDownload: () => void;
  risk: ReturnType<typeof runRiskEngine>;
  auditHead: string | null;
  commitmentCount: number;
}) {
  return (
    <section>
      <PageTitle
        eyebrow="Audit-ready assurance"
        title="Evidence Pack"
        description="把「為何暫停、誰放行、如何防重播」整理成可下載且可重現的決策證據。"
      />
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Immutable event trail</p>
              <h2>Decision timeline</h2>
            </div>
            <History className="size-5 text-slate-500" />
          </div>
          <div className="p-5 sm:p-6">
            {audit.map((event, index) => (
              <div key={`${event.time}-${index}`} className="timeline-row">
                <span
                  className={`timeline-dot ${event.tone === 'danger' ? 'bg-rose-400' : event.tone === 'safe' ? 'bg-emerald-400' : 'bg-slate-500'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row">
                    <h3 className="text-sm font-medium">{event.title}</h3>
                    <time className="font-mono text-[11px] text-slate-500">
                      {event.time} CST
                    </time>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {event.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="panel p-5 sm:p-6">
            <p className="eyebrow">Policy attestation</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <EvidenceDatum
                label="Commitments"
                value={String(commitmentCount)}
              />
              <EvidenceDatum
                label="Audit head"
                value={auditHead ? `${auditHead.slice(0, 12)}…` : 'pending'}
              />
              <EvidenceDatum
                label="Decision"
                value={risk.state === 'CRITICAL' ? 'HOLD' : risk.state}
                danger={risk.state === 'CRITICAL'}
              />
              <EvidenceDatum label="Reason" value={risk.reasonCode} />
            </div>
            <div className="mt-4 rounded-lg border border-white/8 bg-white/3 p-3 text-xs leading-5 text-slate-400">
              <LockKeyhole className="mb-2 size-4 text-cyan-300" />
              LLM 只產生代理意圖；HOLD、分批放行與 nonce
              驗證由外部確定性政策執行。
            </div>
          </div>
          <div className="panel p-5 sm:p-6">
            <p className="eyebrow">Adversarial check</p>
            <h2 className="mt-1 text-lg font-semibold">Replay protection</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              用已消耗的 nonce 重送付款意圖，驗證系統不會重複放款。
            </p>
            <Button
              onClick={onReplay}
              disabled={replayBlocked}
              variant="outline"
              className="mt-4 w-full border-white/12 bg-transparent hover:bg-white/5"
            >
              {replayBlocked ? (
                <CheckCircle2 className="text-emerald-300" />
              ) : (
                <Fingerprint />
              )}
              {replayBlocked ? 'REPLAY BLOCKED' : 'Run replay attack'}
            </Button>
          </div>
          <Button
            onClick={onDownload}
            className="h-11 w-full bg-white font-semibold text-[#07111d] hover:bg-slate-200"
          >
            <Download />
            Download evidence JSON
          </Button>
        </div>
      </div>
    </section>
  );
}

function BreakerDialog({
  risk,
  count,
  prioritize,
  authorizationReason,
  confirmed,
  busy,
  onCount,
  onPrioritize,
  onReason,
  onConfirmed,
  onClose,
  onRelease,
}: {
  risk: ReturnType<typeof runRiskEngine>;
  count: number;
  prioritize: boolean;
  authorizationReason: string;
  confirmed: boolean;
  busy: boolean;
  onCount: (n: number) => void;
  onPrioritize: (b: boolean) => void;
  onReason: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onClose: () => void;
  onRelease: () => void;
}) {
  const candidates = prioritize
    ? selectSafeRelease(
        risk.intents.filter((i) => i.status === 'HELD'),
        count,
      )
    : risk.intents
        .filter((i) => i.status === 'HELD')
        .slice(0, count)
        .map((i) => i.id);
  const total = risk.intents
    .filter((i) => candidates.includes(i.id))
    .reduce((sum, i) => sum + i.amount, 0);
  const canAuthorize =
    confirmed &&
    authorizationReason.trim().length >= 8 &&
    candidates.length > 0 &&
    !busy;
  return (
    <dialog
      open
      className="fixed inset-0 z-50 grid h-full max-h-none w-full max-w-none place-items-center overflow-y-auto bg-[#030914]/80 p-4 text-white backdrop-blur-sm"
      aria-labelledby="breaker-title"
      onCancel={onClose}
    >
      <div className="my-auto w-full max-w-xl overflow-hidden rounded-xl border border-white/12 bg-[#0d1826] shadow-2xl">
        <div className="flex items-start justify-between border-b border-white/8 p-5 sm:p-6">
          <div>
            <p className="eyebrow">Human authorization</p>
            <h2 id="breaker-title" className="mt-1 text-xl font-semibold">
              Staged release controls
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              先放行必要付款，每次放行後重新計算聚合風險。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 hover:bg-white/6 hover:text-white"
            aria-label="關閉"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <Control
            label="Release size"
            value={`${count} intents`}
            detail="MVP 單批上限 10 筆"
          >
            <Slider
              value={[count]}
              min={1}
              max={10}
              step={1}
              onValueChange={(value) => onCount(firstSliderValue(value))}
            />
          </Control>
          <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/3 p-4">
            <div>
              <p className="text-sm font-medium">Critical suppliers first</p>
              <p className="mt-1 text-xs text-slate-500">
                同額度下優先維持營運不中斷
              </p>
            </div>
            <Switch checked={prioritize} onCheckedChange={onPrioritize} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <EvidenceDatum label="Selected" value={String(candidates.length)} />
            <EvidenceDatum label="Batch value" value={formatMoney(total)} />
            <EvidenceDatum
              label="Remaining"
              value={String(
                Math.max(
                  0,
                  risk.intents.filter((i) => i.status === 'HELD').length -
                    candidates.length,
                ),
              )}
            />
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-300">
              Authorization reason
            </span>
            <textarea
              value={authorizationReason}
              onChange={(event) => onReason(event.target.value)}
              rows={2}
              maxLength={160}
              placeholder="例如：維持關鍵供應商服務不中斷"
              className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#091421] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
            />
            <span className="mt-1 block text-[10px] text-slate-500">
              至少 8 個字元；將寫入不可竄改稽核鏈。
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-300/20 bg-amber-300/6 p-3 text-xs leading-5 text-amber-100">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmed(event.target.checked)}
              className="mt-1 size-4 accent-cyan-300"
            />
            <span>
              我已審查本批付款範圍與金額，並明確授權此次模擬分批放行。正式環境仍需企業
              RBAC 與雙人覆核。
            </span>
          </label>
        </div>
        <div className="flex gap-3 border-t border-white/8 p-5 sm:px-6">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1 border-white/12 bg-transparent"
          >
            Cancel
          </Button>
          <Button
            onClick={onRelease}
            disabled={!canAuthorize}
            className="flex-1 bg-cyan-300 font-semibold text-[#07111d] hover:bg-cyan-200"
          >
            <ShieldCheck />
            {busy ? 'Authorizing…' : 'Authorize stage'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-cyan-300">
        {eyebrow}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
        {description}
      </p>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: 'neutral' | 'danger' | 'safe';
}) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{label}</span>
        <Icon className="size-4 text-slate-500" />
      </div>
      <div
        className={`mt-3 font-mono text-xl font-semibold tracking-tight ${tone === 'danger' ? 'text-rose-300' : tone === 'safe' ? 'text-emerald-300' : 'text-slate-100'}`}
      >
        {value}
      </div>
    </div>
  );
}
function DecisionRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/7 pb-3">
      <span className="text-slate-400">{label}</span>
      <span
        className={`font-mono font-medium ${emphasis ? 'text-rose-300' : 'text-slate-100'}`}
      >
        {value}
      </span>
    </div>
  );
}
function Control({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
        <span className="shrink-0 font-mono text-sm text-cyan-300">
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}
function EvidenceDatum({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/3 p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 break-all font-mono text-sm font-medium ${danger ? 'text-rose-300' : 'text-slate-200'}`}
      >
        {value}
      </p>
    </div>
  );
}
function BrandMark() {
  return (
    <div className="relative grid size-9 place-items-center overflow-hidden rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-300">
      <ShieldCheck className="size-5" />
      <span className="absolute bottom-0 h-0.5 w-full bg-cyan-300" />
    </div>
  );
}
function now(offsetSeconds = 0) {
  return new Date(Date.now() + offsetSeconds * 1000).toLocaleTimeString(
    'en-GB',
    {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Taipei',
    },
  );
}
function firstSliderValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0] : value;
}
function validateStressInput(input: unknown): {
  scenarioId: ScenarioId;
  severity: number;
} {
  if (!input || typeof input !== 'object')
    throw new Error('Expected scenarioId and severity.');
  const value = input as Record<string, unknown>;
  const allowed = scenarios.map((item) => item.id);
  if (
    typeof value.scenarioId !== 'string' ||
    !allowed.includes(value.scenarioId as ScenarioId)
  )
    throw new Error('Unknown scenarioId.');
  if (
    typeof value.severity !== 'number' ||
    value.severity < 0.1 ||
    value.severity > 1
  )
    throw new Error('Severity must be between 0.1 and 1.');
  return {
    scenarioId: value.scenarioId as ScenarioId,
    severity: value.severity,
  };
}
function validateReleaseInput(input: unknown) {
  if (!input || typeof input !== 'object')
    throw new Error('Expected release count.');
  const count = (input as Record<string, unknown>).count;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10
  )
    throw new Error('Count must be an integer from 1 to 10.');
  return count;
}
