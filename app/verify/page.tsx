import { EvidenceVerifier } from '@/components/workspace/evidence-verifier';
import { Brand } from '@/components/workspace/shared';
import Link from 'next/link';
export const metadata = {
  title: '獨立證據驗證 · HerdBrake',
  description: '在瀏覽器獨立重算 HerdBrake 證據包，不上傳檔案、不需要登入。',
};
export default function VerifyPage() {
  return (
    <main className="hb-public-verifier">
      <header>
        <Brand />
        <Link className="hb-link" href="/workspace?view=evidence">
          回到工作區 →
        </Link>
      </header>
      <div className="hb-page-heading">
        <p className="hb-eyebrow">INDEPENDENT VERIFICATION</p>
        <h1>讓決策證據，接受獨立檢查。</h1>
        <p className="hb-muted">
          使用與命令列相同的驗證邏輯，直接檢查你收到的證據包。
        </p>
      </div>
      <EvidenceVerifier />
    </main>
  );
}
