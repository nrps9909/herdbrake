import { requireApiUser } from '@/lib/server/access';
import { assuranceStore } from '@/lib/server/assurance-store';
import { parseObject } from '@/lib/contracts';
import { apiHandler, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const body = parseObject(await readJson(request, 40_960));
    const result = await assuranceStore(user.userId).importRun({
      name: body.name as string,
      csv: body.csv as string,
      policyRevision: body.policyRevision as number,
    });
    return json(result, { status: 201 });
  }, '無法匯入付款批次。');
}
