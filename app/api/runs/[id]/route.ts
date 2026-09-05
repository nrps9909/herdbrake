import { assuranceStore } from '@/lib/server/assurance-store';
import { requireApiUser } from '@/lib/server/access';
import { NotFoundError } from '@/lib/errors';
import { apiHandler, json } from '@/lib/server/http';
import type { RunContext } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: RunContext) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const result = await assuranceStore(user.userId).getStoredRun(id);
    if (!result) throw new NotFoundError();
    return json(result);
  }, 'Unable to read stress run.');
}
