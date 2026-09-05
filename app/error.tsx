'use client';

import { Button } from '@/components/ui/button';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7fa] p-6 text-[#101828]">
      <section className="w-full max-w-md rounded-xl border border-[#dfe3e8] bg-white p-8">
        <p className="text-sm font-semibold text-[#175cd3]">HerdBrake</p>
        <h1 className="mt-3 text-2xl font-semibold">暫時無法顯示工作站</h1>
        <p className="my-5 text-base leading-7 text-[#475467]">
          請重新載入畫面以讀取後端最新狀態；如果剛才已送出授權，請先核對付款紀錄。
        </p>
        <Button
          onClick={reset}
          className="bg-[#155eef] text-white hover:bg-[#004eeb]"
        >
          重新載入工作站
        </Button>
      </section>
    </main>
  );
}
