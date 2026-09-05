import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ApiError } from '../errors';
import { getDatabase } from './db';
import { createWorkspaceRepository } from './workspace-repository';

export async function requireApiUser(request: Request) {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError('請先登入工作區。', 401, 'HB_UNAUTHENTICATED');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (
      request.headers.get('x-herdbrake-client') !== 'workspace' ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== new URL(request.url).origin)
    )
      throw new ApiError(
        '請從 HerdBrake 工作區送出操作。',
        403,
        'HB_FORBIDDEN',
      );
    await createWorkspaceRepository(
      getDatabase(),
      user.userId,
    ).consumeMutationLimit();
  }
  return user;
}
