import { assuranceStore } from '@/lib/server/assurance-store';
import { parseRunInput } from '@/lib/contracts';
import { apiHandler, json, readJson } from '@/lib/server/http';
import { requireApiUser } from '@/lib/server/access';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const store = assuranceStore(user.userId);
    const query = new URL(request.url).searchParams;
    if (query.has('list'))
      return json(
        await store.listRuns({
          search: query.get('search') ?? '',
          state: query.get('state') ?? 'ALL',
          page: Number(query.get('page') ?? 0),
        }),
      );
    const latest = await store.getLatestStoredRun();
    return latest
      ? json(latest)
      : new Response(null, {
          status: 204,
          headers: { 'cache-control': 'no-store' },
        });
  }, '無法讀取批次資料。');
}
export function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const result = await assuranceStore(user.userId).createStressRun(
      parseRunInput(await readJson(request)),
    );
    return json(result, {
      status: 201,
      headers: { location: `/api/runs/${result.runId}` },
    });
  }, '無法儲存這次測試。');
}
