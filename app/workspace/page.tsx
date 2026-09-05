import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { WorkspaceApp } from '@/components/workspace/workspace-app';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: '我的工作區 · HerdBrake',
  robots: { index: false, follow: false },
};
async function SignedInWorkspace({ returnTo }: { returnTo: string }) {
  const user = await requireChatGPTUser(returnTo);
  return <WorkspaceApp user={user} signOutPath={chatGPTSignOutPath('/')} />;
}
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['view', 'run'])
    if (typeof params[key] === 'string')
      query.set(key, params[key].slice(0, 100));
  return (
    <SignedInWorkspace
      returnTo={`/workspace${query.size ? '?' + query : ''}`}
    />
  );
}
