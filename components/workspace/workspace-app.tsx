'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  ChevronRight,
  FileClock,
  FileSpreadsheet,
  FlaskConical,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  WalletCards,
  X,
  RefreshCw,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useWebMCP } from '@/hooks/use-webmcp';
import { evaluateRisk } from '@/lib/herdbrake';
import type { ScenarioId } from '@/lib/herdbrake';
import { defaultPolicy } from '@/lib/policy';
import { viewTitles } from '@/lib/workspace-types';
import type { WorkspaceView } from '@/lib/workspace-types';
import { Brand } from './shared';
import { RiskOverview } from './risk-overview';
import { HistoryPanel } from './history-panel';
import { LedgerPanel } from './ledger-panel';
import { ImportPanel } from './import-panel';
import { LabPanel } from './lab-panel';
import { EvidencePanel } from './evidence-panel';
import { SettingsPanel } from './settings-panel';
import { ReviewDialog } from './review-dialog';
import { AgentPanel } from './agent-panel';
// Sites owns this endpoint; it requires full-page navigation instead of client routing.
const signInPath = '/signin-with-chatgpt?return_to=%2Fworkspace';
const navigation = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'history', icon: FileSpreadsheet },
  { id: 'ledger', icon: WalletCards },
  { id: 'import', icon: Upload },
  { id: 'lab', icon: FlaskConical },
  { id: 'agents', icon: Bot },
  { id: 'evidence', icon: FileClock },
  { id: 'settings', icon: Settings2 },
] as const;
export function WorkspaceApp({
  user,
  signOutPath,
}: {
  user: ChatGPTUser;
  signOutPath: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const requestedView = params.get('view');
  const view: WorkspaceView =
    requestedView && Object.hasOwn(viewTitles, requestedView)
      ? (requestedView as WorkspaceView)
      : 'overview';
  const selectedId = params.get('run');
  const data = useWorkspace(selectedId);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [review, setReview] = useState<number | null>(null);
  const go = (next: WorkspaceView, id = selectedId) => {
    if (data.busy) return;
    setMobile(false);
    setSearch(false);
    setReview(null);
    const query = new URLSearchParams({ view: next });
    if (id) query.set('run', id);
    router.push(`/workspace?${query}`);
  };
  const openRun = (id: string) => go('ledger', id);
  const runScenario = async (id: ScenarioId, severity: number) => {
    const saved = await data.create({
      scenarioId: id,
      severity,
      liquidityFloor: data.workspace?.settings.policy.liquidityFloor ?? 75,
    });
    go('ledger', saved.runId);
    return saved;
  };
  useWebMCP({
    risk: data.run?.risk ?? evaluateRisk([], 75, defaultPolicy),
    runId: data.run?.runId ?? null,
    floor: data.workspace?.settings.policy.liquidityFloor ?? 75,
    runScenario,
    onLaunch: () => undefined,
    onPrepare: (count) => {
      if (!data.run || data.loading || data.busy)
        throw new Error('請等候批次載入完成，再準備審核。');
      if (!data.run.risk.intents.some((intent) => intent.status === 'HELD'))
        throw new Error('此批次沒有待審核意圖。');
      setReview(count);
    },
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch((current) => !current);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const nav = (
    items: typeof navigation | ReadonlyArray<(typeof navigation)[number]>,
  ) => (
    <nav className="hb-nav" aria-label="工作區導覽">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => go(item.id)}
          disabled={data.busy}
          aria-current={view === item.id ? 'page' : undefined}
        >
          <item.icon size={18} />
          {viewTitles[item.id]}
          {item.id === 'history' && Boolean(data.list?.total) && (
            <span>{data.list?.total}</span>
          )}
        </button>
      ))}
    </nav>
  );
  const panel = () => {
    if (data.loading)
      return (
        <output className="hb-loading" aria-label="正在讀取工作區">
          <span />
          <span />
          <span />
        </output>
      );
    if (!data.workspace || !data.list)
      return (
        <div className="hb-empty">
          <h3>暫時無法讀取工作區</h3>
          <p>請確認登入狀態，或重新嘗試連線。</p>
          <Button className="hb-primary" onClick={data.refresh}>
            重新載入
          </Button>
          <a className="hb-link" href={signInPath} target="_top">
            重新登入
          </a>
        </div>
      );
    switch (view) {
      case 'overview':
        return (
          <RiskOverview
            list={data.list}
            run={data.run}
            onOpen={openRun}
            onImport={() => go('import')}
            onLab={() => go('lab')}
            onReview={() => setReview(5)}
          />
        );
      case 'history':
        return <HistoryPanel onOpen={openRun} onImport={() => go('import')} />;
      case 'ledger':
        return (
          <LedgerPanel
            key={data.run?.runId ?? 'empty'}
            run={data.run}
            busy={data.busy}
            onReview={() => setReview(5)}
            onImport={() => go('import')}
            onEvidence={() => go('evidence')}
          />
        );
      case 'import':
        return (
          <ImportPanel
            settings={data.workspace.settings}
            busy={data.busy}
            onImport={async (input) => {
              const saved = await data.importRun(input);
              go('ledger', saved.runId);
            }}
          />
        );
      case 'lab':
        return (
          <LabPanel
            settings={data.workspace.settings}
            busy={data.busy}
            onRun={runScenario}
          />
        );
      case 'agents':
        return (
          <AgentPanel
            run={data.run}
            busy={data.busy}
            onRun={async (mode) => {
              const saved = await data.runAgents(mode);
              go('agents', saved.runId);
            }}
            onReview={() => setReview(5)}
            onLedger={() => go('ledger')}
          />
        );
      case 'evidence':
        return (
          <EvidencePanel
            key={data.run?.auditHead}
            run={data.run}
            busy={data.busy}
            onReplay={data.replay}
            onImport={() => go('import')}
          />
        );
      case 'settings':
        return (
          <SettingsPanel
            key={data.workspace.settings.revision}
            data={data.workspace}
            user={user}
            busy={data.busy}
            onSave={data.saveSettings}
            onRefresh={data.refresh}
          />
        );
    }
  };
  return (
    <div className="hb-app">
      <a href="#workspace-main" className="hb-skip-link">
        跳至主要內容
      </a>
      <aside className="hb-sidebar">
        <Brand />
        <div className="hb-workspace-switch">
          <span className="hb-square">
            <Building2 size={17} />
          </span>
          <div>
            <strong>{data.workspace?.settings.name ?? '我的財務工作區'}</strong>
            <small>個人工作區</small>
          </div>
        </div>
        <p className="hb-nav-label">WORKSPACE</p>
        {nav(navigation.slice(0, 6))}
        <p className="hb-nav-label">MANAGE</p>
        {nav(navigation.slice(6))}
        <div className="hb-sidebar-bottom">
          <div className="hb-support-card">
            <ShieldCheck size={20} />
            <strong>每筆決策，都有依據</strong>
            從匯入到審核，在同一個工作區完成。
            <button onClick={() => setHelp(true)}>
              查看使用指南
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="hb-user">
            <span className="hb-avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="hb-user-info">
              <strong>{user.displayName}</strong>
              <small>{user.email || 'ChatGPT 帳號'}</small>
            </div>
            <a
              href={signOutPath}
              target="_top"
              className="hb-icon-button"
              aria-label="登出"
            >
              <LogOut size={16} />
            </a>
          </div>
        </div>
      </aside>
      <div className="hb-main">
        <header className="hb-topbar">
          <div className="hb-breadcrumb">
            <button
              className="hb-mobile-menu hb-icon-button"
              aria-label="開啟導覽"
              onClick={() => setMobile(true)}
            >
              <Menu size={19} />
            </button>
            <span>工作區</span>
            <ChevronRight size={13} />
            <strong>{viewTitles[view]}</strong>
          </div>
          <div className="hb-top-actions">
            <button
              className="hb-search-trigger"
              aria-label="搜尋批次"
              onClick={() => setSearch(true)}
            >
              <Search size={15} />
              <span>搜尋批次…</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="hb-icon-button"
              onClick={() => setHelp(true)}
              aria-label="使用指南"
            >
              <HelpCircle size={18} />
            </button>
            <span className="hb-avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main
          id="workspace-main"
          className="hb-content"
          tabIndex={-1}
          aria-busy={data.loading || data.busy}
        >
          {data.notice && (
            <div
              className={`hb-notice ${data.notice.error ? 'error' : ''}`}
              role={data.notice.error ? 'alert' : 'status'}
            >
              <ShieldCheck size={17} />
              <span>{data.notice.message}</span>
              {data.notice.error && (
                <button
                  className="hb-icon-button"
                  aria-label="重新載入"
                  disabled={data.busy}
                  onClick={data.refresh}
                >
                  <RefreshCw size={16} />
                </button>
              )}
              <button
                className="hb-icon-button"
                aria-label="關閉訊息"
                onClick={() => data.setNotice(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {panel()}
          <footer className="hb-footer">
            <span>HerdBrake · Treasury Workspace</span>
            <span>決策審核與追溯 · 未串接資金移轉</span>
          </footer>
        </main>
      </div>
      <nav className="hb-bottom-nav" aria-label="行動版快捷導覽">
        {navigation.slice(0, 5).map((item) => (
          <button
            key={item.id}
            aria-current={view === item.id ? 'page' : undefined}
            disabled={data.busy}
            onClick={() => go(item.id)}
          >
            <item.icon size={19} />
            <span>{viewTitles[item.id]}</span>
          </button>
        ))}
      </nav>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="hb-dialog">
          <div>
            <DialogTitle className="hb-dialog-title">
              開始使用 HerdBrake
            </DialogTitle>
            <DialogDescription className="hb-dialog-description">
              三個步驟，把付款決策整理清楚。
            </DialogDescription>
          </div>
          <div className="hb-help-list">
            <div>
              <h3>01 · 準備批次</h3>
              <p>
                到「匯入批次」下載 CSV
                範本，填入單位、動作、目的地、金額、幣別與關鍵付款標記。也可以從情境實驗室建立模擬資料。
              </p>
            </div>
            <div>
              <h3>02 · 檢查並審核</h3>
              <p>
                查看整批風險與付款清單，再選擇最多 10
                筆付款意圖分批核准。核准前會顯示明細、合計與理由欄位。
              </p>
            </div>
            <div>
              <h3>03 · 回溯與匯出</h3>
              <p>
                在批次紀錄重新開啟資料，到稽核與證據驗證紀錄完整性、檢查重播防護，或下載
                CSV 和 JSON 證據包。
              </p>
            </div>
          </div>
          <Button
            className="hb-primary"
            onClick={() => {
              setHelp(false);
              go('import');
            }}
          >
            前往匯入
            <ArrowRight size={16} />
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={search} onOpenChange={setSearch}>
        <DialogContent className="hb-dialog hb-search-dialog">
          <DialogTitle className="hb-dialog-title">快速開啟批次</DialogTitle>
          <DialogDescription className="sr-only">
            依名稱或批次識別碼搜尋你的工作區。
          </DialogDescription>
          <HistoryPanel
            compact
            onOpen={openRun}
            onImport={() => go('import')}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={mobile} onOpenChange={setMobile}>
        <DialogContent className="hb-dialog hb-mobile-dialog">
          <DialogTitle className="hb-dialog-title">工作區導覽</DialogTitle>
          <DialogDescription className="sr-only">
            選擇功能頁面
          </DialogDescription>
          {nav(navigation)}
          <a className="hb-link" href={signOutPath} target="_top">
            <LogOut size={16} />
            登出
          </a>
        </DialogContent>
      </Dialog>
      {review !== null && data.run && !data.loading && (
        <ReviewDialog
          key={data.run.auditHead}
          run={data.run}
          initialCount={review}
          busy={data.busy}
          onClose={() => setReview(null)}
          onRelease={data.release}
        />
      )}
    </div>
  );
}
