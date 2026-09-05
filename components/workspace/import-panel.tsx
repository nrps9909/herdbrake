'use client';
import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileSpreadsheet,
  UploadCloud,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { csvTemplate, previewImport } from '@/lib/import-csv';
import type { WorkspaceSettings } from '@/lib/policy';
import { SectionTitle, saveFile, money } from './shared';
import { errorText } from '@/hooks/use-workspace';
export function ImportPanel({
  settings,
  busy,
  onImport,
}: {
  settings: WorkspaceSettings;
  busy: boolean;
  onImport: (input: {
    name: string;
    csv: string;
    policyRevision: number;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const fileVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => {
    if (!csv) return null;
    try {
      return previewImport(csv, settings.policy);
    } catch (cause) {
      return {
        intents: [],
        issues: [{ row: 0, field: 'file', message: errorText(cause) }],
        rowCount: 0,
      };
    }
  }, [csv, settings.policy]);
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const version = ++fileVersion.current;
    setError('');
    setCsv('');
    setFileName('');
    setReading(false);
    if (file.size > 32768) {
      setError('檔案上限為 32 KB，請分批匯入。');
      return;
    }
    setReading(true);
    try {
      const value = await file.text();
      if (version !== fileVersion.current) return;
      setCsv(value);
      setFileName(file.name);
      setName((current) => current || file.name.replace(/\.csv$/i, ''));
    } catch (cause) {
      if (version === fileVersion.current) setError(errorText(cause));
    } finally {
      if (version === fileVersion.current) setReading(false);
    }
  };
  const valid = Boolean(
    !reading &&
    name.trim() &&
    preview?.intents.length &&
    !preview.issues.length,
  );
  return (
    <>
      <SectionTitle
        eyebrow="IMPORT PAYMENTS"
        title="讓每一筆付款，都有依據"
        description="匯入 CSV、確認欄位，系統會依工作區政策評估整批風險。"
      >
        <Button
          className="hb-secondary"
          onClick={() =>
            saveFile(
              csvTemplate,
              'herdbrake-template.csv',
              'text/csv;charset=utf-8',
            )
          }
        >
          <Download size={15} />
          下載範本
        </Button>
      </SectionTitle>
      <div className="hb-view-grid">
        <div className="hb-card">
          <div className="hb-card-header">
            <div className="hb-step">
              <span>01</span>
              <h2>準備你的付款清單</h2>
            </div>
            <span className="hb-soft-label">CSV · 最多 50 筆</span>
          </div>
          <div className="hb-card-body">
            <div className="hb-field">
              <label htmlFor="batch-name">批次名稱</label>
              <Input
                id="batch-name"
                className="hb-input"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：九月供應商付款"
                disabled={busy}
              />
            </div>
            <div className="hb-field">
              <label htmlFor="csv-file">付款資料</label>
              <div
                className={`hb-dropzone ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!busy) void readFile(e.dataTransfer.files[0]);
                }}
              >
                <UploadCloud size={27} />
                <strong>
                  {reading ? '正在讀取檔案…' : fileName || '將 CSV 拖曳到這裡'}
                </strong>
                <p>UTF-8 編碼 · 上限 32 KB · 支援 TWD、USD、USDC</p>
                <Button
                  className="hb-secondary"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <FileSpreadsheet size={15} />
                  {csv ? '重新選擇檔案' : '選擇檔案'}
                </Button>
                <input
                  ref={fileInput}
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    void readFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            <details className="hb-field">
              <summary className="hb-link">或直接貼上 / 修正 CSV 內容</summary>
              <label htmlFor="csv-content" className="sr-only">
                CSV 內容
              </label>
              <textarea
                id="csv-content"
                className="hb-textarea"
                value={csv}
                onChange={(e) => {
                  fileVersion.current++;
                  setReading(false);
                  setFileName('');
                  setCsv(e.target.value);
                  setError('');
                }}
                placeholder={csvTemplate}
                disabled={busy}
              />
            </details>
            {error && (
              <p role="alert" className="hb-issue">
                {error}
              </p>
            )}
            {preview && (
              <>
                <div className="hb-import-meta">
                  <Check size={15} />
                  {preview.rowCount} 筆資料{' '}
                  <span>
                    {preview.issues.length
                      ? `${preview.issues.length} 處需修正`
                      : '所有欄位檢查通過'}
                  </span>
                </div>
                {preview.issues.slice(0, 8).map((issue, index) => (
                  <p className="hb-issue" key={index}>
                    {issue.row > 0 ? `第 ${issue.row} 列 · ` : ''}
                    {issue.message}
                  </p>
                ))}
                {preview.issues.length > 8 && (
                  <p className="hb-muted">
                    另有 {preview.issues.length - 8} 處錯誤，修正後將重新檢查。
                  </p>
                )}
                {preview.intents.length > 0 && (
                  <div className="hb-table-scroll">
                    <table className="hb-table">
                      <caption className="sr-only">匯入預覽，前五筆</caption>
                      <thead>
                        <tr>
                          <th>付款單位</th>
                          <th>動作</th>
                          <th>目的地</th>
                          <th>金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.intents.slice(0, 5).map((item) => (
                          <tr key={item.id}>
                            <td>{item.entity}</td>
                            <td>{item.action}</td>
                            <td>{item.destination}</td>
                            <td className="hb-nowrap">
                              {money(item.amount, item.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="hb-card-footer">
            {preview?.intents.length
              ? `預覽前 ${Math.min(5, preview.intents.length)} 筆，儲存時會納入所有有效資料。`
              : '檔案內容只會在你確認匯入時送出。'}
          </div>
        </div>
        <aside className="hb-card hb-side-card">
          <div className="hb-card-header">
            <div className="hb-step">
              <span>02</span>
              <h2>確認並建立批次</h2>
            </div>
          </div>
          <div className="hb-card-body">
            <div className="hb-help-list">
              <div>
                <h3>先檢查單筆，再看整體</h3>
                <p>
                  欄位、幣別與單筆限額通過後，再檢查資金緩衝、方向一致性及目的地集中度。
                </p>
              </div>
              <div>
                <h3>目前使用的政策</h3>
                <p>
                  {settings.revision ? `版本 ${settings.revision}` : '預設政策'}{' '}
                  · 緩衝底線 {settings.policy.liquidityFloor}%<br />
                  單筆上限 {money(settings.policy.maxIntentUsd)}
                  <br />
                  期初資金 {money(settings.policy.openingLiquidity)}
                </p>
              </div>
              <div>
                <h3>資料保存於你的工作區</h3>
                <p>匯入後可查閱原始清單、逐批審核與下載完整證據紀錄。</p>
              </div>
            </div>
            <Button
              className="hb-primary hb-full"
              style={{ marginTop: 25 }}
              disabled={!valid || busy}
              onClick={() => {
                setError('');
                void onImport({
                  name: name.trim(),
                  csv,
                  policyRevision: settings.revision,
                }).catch((cause) => setError(errorText(cause)));
              }}
            >
              {busy
                ? '正在評估並儲存…'
                : `確認匯入${preview?.intents.length ? ` ${preview.intents.length} 筆` : ''}`}
              <ArrowRight size={15} />
            </Button>
          </div>
        </aside>
      </div>
    </>
  );
}
