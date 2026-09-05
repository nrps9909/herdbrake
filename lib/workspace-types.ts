export type WorkspaceView =
  | 'overview'
  | 'history'
  | 'ledger'
  | 'lab'
  | 'agents'
  | 'import'
  | 'evidence'
  | 'settings';
export type RunSummary = {
  id: string;
  name: string;
  scenarioId: string;
  source: 'scenario' | 'import' | 'ai';
  state: 'NORMAL' | 'REVIEW' | 'CRITICAL';
  reasonCode: string;
  projectedBuffer: number;
  proposedOutflow: number;
  intentCount: number;
  heldCount: number;
  createdAt: string;
};
export type RunList = {
  items: RunSummary[];
  total: number;
  page: number;
  summary: {
    runCount: number;
    criticalCount: number;
    heldCount: number;
    releasedCount: number;
  };
};
export const viewTitles: Record<WorkspaceView, string> = {
  overview: '工作總覽',
  history: '批次紀錄',
  ledger: '付款意圖',
  lab: '情境實驗室',
  agents: 'AI 付款協作',
  import: '匯入批次',
  evidence: '稽核與證據',
  settings: '工作區設定',
};
export const dateLabel = (date: string) =>
  new Date(date).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Taipei',
  });
