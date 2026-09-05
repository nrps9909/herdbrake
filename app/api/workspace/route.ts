import { requireApiUser } from '@/lib/server/access';
import { createWorkspaceRepository } from '@/lib/server/workspace-repository';
import { getDatabase } from '@/lib/server/db';
import { apiHandler, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    const repository = createWorkspaceRepository(getDatabase(), user.userId);
    const [settings, history] = await Promise.all([
      repository.getSettings(),
      repository.history(),
    ]);
    return json({ settings, history });
  }, '無法讀取工作區。');
}
export function PATCH(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser(request);
    return json(
      await createWorkspaceRepository(
        getDatabase(),
        user.userId,
      ).updateSettings(await readJson(request)),
    );
  }, '無法儲存政策設定。');
}
