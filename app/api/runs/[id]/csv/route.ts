import { requireApiUser } from '@/lib/server/access';
import { assuranceStore } from '@/lib/server/assurance-store';
import { apiHandler } from '@/lib/server/http';
import type { RunContext } from '@/lib/server/http';
import { NotFoundError } from '@/lib/errors';
import { intentsCsv } from '@/lib/import-csv';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: RunContext) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const run = await assuranceStore(user.userId).getStoredRun(id);
    if (!run) throw new NotFoundError();
    return new Response(intentsCsv(run.risk.intents), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="herdbrake-${id}.csv"`,
      },
    });
  }, '無法匯出 CSV。');
}
