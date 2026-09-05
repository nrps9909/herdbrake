import { assuranceStore } from '@/lib/server/assurance-store';
import { requireApiUser } from '@/lib/server/access';
import { NotFoundError } from '@/lib/errors';
import { apiHandler, json, readJson } from '@/lib/server/http';
import type { RunContext } from '@/lib/server/http';
import { parseReleaseInput } from '@/lib/contracts';
export const dynamic = 'force-dynamic';
export function POST(request: Request, context: RunContext) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const result = await assuranceStore(user.userId).releaseIntents(
      id,
      parseReleaseInput(
        await readJson(request),
        request.headers.get('idempotency-key'),
      ),
    );
    if (!result) throw new NotFoundError();
    return json(result);
  }, 'Unable to stage release.');
}
