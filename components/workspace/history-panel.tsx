'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/client-api';
import type { RunList } from '@/lib/workspace-types';
import { SectionTitle, RunTable, StatusBadge, EmptyState } from './shared';
import { errorText } from '@/hooks/use-workspace';
export function HistoryPanel({
  onOpen,
  onImport,
  compact = false,
}: {
  onOpen: (id: string) => void;
  onImport: () => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [state, setState] = useState('ALL');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<RunList | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const loadKey = JSON.stringify([search, state, page, retry]);
  const loading = loadKey !== loadedKey;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiRequest<RunList>(
        `/api/runs?list=1&search=${encodeURIComponent(search)}&state=${state}&page=${page}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult(data);
            setError('');
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(errorText(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadedKey(loadKey);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, state, page, loadKey]);
  return (
    <>
      {!compact && (
        <SectionTitle
          eyebrow="BATCH HISTORY"
          title="每次決策，都找得到"
          description="搜尋已保存的批次，回到原始付款清單與完整審核紀錄。"
        >
          <Button className="hb-primary" onClick={onImport}>
            <Plus size={16} />
            匯入新批次
          </Button>
        </SectionTitle>
      )}
      <div className={compact ? '' : 'hb-card'}>
        <div className="hb-toolbar">
          <div className="hb-search">
            <Search size={16} />
            <Input
              aria-label="搜尋批次名稱或識別碼"
              placeholder="搜尋批次名稱或識別碼…"
              value={search}
              className="hb-input"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {!compact && (
            <div className="hb-segments" aria-label="依風險篩選">
              {[
                ['ALL', '全部'],
                ['CRITICAL', '高風險'],
                ['REVIEW', '待覆核'],
                ['NORMAL', '正常'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={state === value}
                  onClick={() => {
                    setState(value);
                    setPage(0);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {error && !loading ? (
          <div className="hb-empty" role="alert">
            <p>{error}</p>
            <Button
              className="hb-secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              重新載入
            </Button>
          </div>
        ) : loading ? (
          <output className="hb-empty">
            <p>正在搜尋批次…</p>
          </output>
        ) : compact ? (
          result?.items.length ? (
            <div className="hb-quick-results">
              {result.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpen(item.id)}
                  aria-label={`開啟 ${item.name}`}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.source === 'ai'
                        ? 'AI 付款提案'
                        : item.source === 'import'
                          ? 'CSV 匯入'
                          : '情境模擬'}{' '}
                      · {item.id.slice(-8)} · {item.intentCount} 筆
                    </small>
                  </span>
                  <StatusBadge state={item.state} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="找不到符合的批次"
              description="試試其他名稱或批次識別碼。"
            />
          )
        ) : (
          <RunTable
            items={result?.items ?? []}
            onOpen={onOpen}
            emptyAction={onImport}
          />
        )}
        {result && !error && (
          <div className="hb-pagination">
            <span>
              共 {result.total} 筆 · 第 {page + 1} /{' '}
              {Math.max(1, Math.ceil(result.total / 20))} 頁
            </span>
            <div>
              <button
                className="hb-icon-button"
                aria-label="上一頁"
                disabled={page === 0 || loading}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="hb-icon-button"
                aria-label="下一頁"
                disabled={(page + 1) * 20 >= result.total || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
