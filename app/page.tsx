import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileCheck2,
  FileSpreadsheet,
  Fingerprint,
  Layers3,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
import { Brand, StatusBadge } from '@/components/workspace/shared';
import { runRiskEngine } from '@/lib/herdbrake';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await getChatGPTUser();
  const href = user ? '/workspace' : chatGPTSignInPath('/workspace');
  const sample = runRiskEngine({
    scenarioId: 'stablecoin',
    severity: 0.8,
    liquidityFloor: 75,
  });
  return (
    <div className="hb-landing">
      <header className="hb-public-header">
        <Link href="/" aria-label="HerdBrake 首頁">
          <Brand />
        </Link>
        <nav aria-label="首頁導覽">
          <a href="#workflow">工作流程</a>
          <a href="#capabilities">產品功能</a>
          <a href="#questions">常見問題</a>
        </nav>
        <a href={href} target="_top" className="hb-public-login">
          {user ? '回到工作區' : '登入工作區'}
          <ArrowRight size={16} />
        </a>
      </header>
      <main>
        <section className="hb-hero">
          <div className="hb-hero-copy">
            <p className="hb-hero-eyebrow">
              <span />
              為每一筆財務決策，多想一步
            </p>
            <h1>
              看見整體風險，
              <br />
              再讓付款<span>往前一步。</span>
            </h1>
            <p>
              把分散的付款意圖，整理成清楚的決策。
              <br className="hb-desktop-break" />
              從 AI 提案、資料匯入到審核追溯，在同一個工作區完成。
            </p>
            <div className="hb-hero-actions">
              <a className="hb-public-primary" href={href} target="_top">
                進入我的工作區
                <ArrowRight size={17} />
              </a>
              <a className="hb-public-secondary" href="#workflow">
                了解運作方式
                <ChevronRight size={17} />
              </a>
            </div>
            <div className="hb-hero-notes">
              <span>
                <Check size={14} />
                個人資料隔離
              </span>
              <span>
                <Check size={14} />
                保留完整紀錄
              </span>
              <span>
                <Check size={14} />
                由你決定核准
              </span>
            </div>
          </div>
          <div className="hb-product-preview" aria-label="合成情境的產品預覽">
            <div className="hb-preview-top">
              <span>
                <ShieldCheck size={17} />
                HerdBrake
              </span>
              <small>示範資料 · 穩定幣情境</small>
              <span className="hb-preview-avatar">J</span>
            </div>
            <div className="hb-preview-interior">
              <div className="hb-preview-mini-nav">
                <Layers3 size={17} />
                <FileSpreadsheet size={17} />
                <Fingerprint size={17} />
                <SlidersHorizontal size={17} />
              </div>
              <div className="hb-preview-dashboard">
                <div className="hb-preview-heading">
                  <div>
                    <small>YOUR NEXT DECISION</small>
                    <h2>把風險，看得更清楚。</h2>
                  </div>
                  <StatusBadge state={sample.state} />
                </div>
                <div className="hb-preview-stats">
                  <div>
                    <span>待審核意圖</span>
                    <strong>
                      {sample.intents.length}
                      <small>筆</small>
                    </strong>
                  </div>
                  <div>
                    <span>方向一致性</span>
                    <strong>
                      {Math.round(sample.directionalAgreement)}
                      <small>%</small>
                    </strong>
                  </div>
                  <div>
                    <span>預估資金緩衝</span>
                    <strong>
                      {sample.projectedBuffer.toFixed(1)}
                      <small>%</small>
                    </strong>
                  </div>
                </div>
                <div className="hb-preview-chart">
                  <div>
                    <span>付款動作分布</span>
                    <small>合成情境預覽</small>
                  </div>
                  {(
                    ['PAY', 'DELAY', 'BUFFER', 'TRANSFER', 'USDC'] as const
                  ).map((action, index) => {
                    const count = sample.intents.filter(
                      (item) => item.action === action,
                    ).length;
                    return (
                      <div className="hb-preview-bar" key={action}>
                        <span>{action}</span>
                        <div>
                          <i
                            style={{
                              width: `${(count / sample.intents.length) * 100}%`,
                              background: [
                                '#5264e9',
                                '#8392ee',
                                '#b2bef4',
                                '#6baaaa',
                                '#bbc7d7',
                              ][index],
                            }}
                          />
                        </div>
                        <strong>{count}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="hb-preview-bottom">
                  <span>
                    <FileCheck2 size={17} />
                    先審查明細，再分批核准
                  </span>
                  <span>
                    查看批次 <ArrowRight size={13} />
                  </span>
                </div>
              </div>
            </div>
            <div className="hb-preview-floating">
              <span>
                <Fingerprint size={21} />
              </span>
              <div>
                <strong>決策有跡可循</strong>
                <small>原始資料、政策與審核一併保存</small>
              </div>
              <Check size={16} />
            </div>
          </div>
        </section>
        <section id="workflow" className="hb-public-section">
          <div className="hb-public-section-heading">
            <p className="hb-eyebrow">A CLEARER WAY TO WORK</p>
            <h2>
              複雜的付款決策，
              <br />
              有條理地完成。
            </h2>
            <p>不必在試算表與訊息之間，拼湊每一次審核的來龍去脈。</p>
          </div>
          <div className="hb-workflow-grid">
            {[
              {
                number: '01',
                icon: FileSpreadsheet,
                title: '把資料整理進來',
                text: '拖放付款清單，直接預覽並修正欄位。多幣別換算與單筆限額，在送出前就能確認。',
              },
              {
                number: '02',
                icon: ShieldCheck,
                title: '從整體風險做判斷',
                text: '同時觀察資金緩衝、行動一致性與目的地集中程度，再核對每一筆付款的細節。',
              },
              {
                number: '03',
                icon: Fingerprint,
                title: '讓每次決策可追溯',
                text: '分批核准、記下理由，保留當時的政策設定。之後隨時搜尋、驗證與匯出紀錄。',
              },
            ].map((item) => (
              <article key={item.number}>
                <div>
                  <span>
                    <item.icon size={23} />
                  </span>
                  <small>{item.number}</small>
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="capabilities" className="hb-feature-section">
          <div className="hb-feature-copy">
            <p className="hb-eyebrow">BUILT FOR THOUGHTFUL DECISIONS</p>
            <h2>
              需要的細節，
              <br />
              都在順手的位置。
            </h2>
            <p>
              清楚的清單、穩定的流程，和真正能重新開啟的紀錄。讓日常操作少一點猜測。
            </p>
            <a className="hb-public-primary" href={href} target="_top">
              開始使用
              <ArrowRight size={17} />
            </a>
          </div>
          <div className="hb-feature-grid">
            {[
              {
                icon: Layers3,
                title: 'AI 提案與人工把關',
                text: '檢視模型理由，讓所有提案先通過聚合風控。',
              },
              {
                icon: FileSpreadsheet,
                title: '搜尋與匯出',
                text: '依名稱和風險篩選，下載付款 CSV。',
              },
              {
                icon: SlidersHorizontal,
                title: '有版本的政策',
                text: '調整限額與門檻，保留歷史評估依據。',
              },
              {
                icon: LockKeyhole,
                title: '你的個人工作區',
                text: '登入後保存資料，各帳號分別管理。',
              },
            ].map((item) => (
              <article key={item.title}>
                <item.icon size={23} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="questions" className="hb-public-section hb-faq">
          <div className="hb-public-section-heading">
            <p className="hb-eyebrow">GOOD TO KNOW</p>
            <h2>開始之前，你可能想知道</h2>
          </div>
          {[
            [
              '可以直接處理自己的付款清單嗎？',
              '可以。登入後下載 CSV 範本，填妥六個欄位即可匯入，每批最多 50 筆。你也可以先使用情境實驗室熟悉評估流程。',
            ],
            [
              '核准後會直接付款嗎？',
              '目前核准會更新付款意圖狀態並保存審核紀錄，沒有串接銀行、錢包或實際資金移轉。',
            ],
            [
              '資料與匯率會如何處理？',
              '批次資料保存於登入帳號的工作區。匯率由你在政策設定中手動指定，每筆批次保留當時的設定，方便重新檢查與追溯。',
            ],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span>+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </section>
      </main>
      <footer className="hb-public-footer">
        <Brand />
        <p>更清楚地看見風險，更有依據地做決定。</p>
        <span>© {new Date().getFullYear()} 簡易智能代理工作</span>
      </footer>
    </div>
  );
}
