import { defaultPolicy, parsePolicy } from '../policy.ts';
import type { WorkspaceSettings } from '../policy.ts';
import { ApiError, ConflictError } from '../errors.ts';
import { parseObject } from '../contracts.ts';

type SettingsRow = {
  name: string;
  revision: number;
  policy_json: string;
  updated_at: string;
};
export function createWorkspaceRepository(
  database: D1Database,
  ownerId: string,
) {
  if (!ownerId) throw new ApiError('請先登入。', 401, 'HB_UNAUTHENTICATED');
  const statement = (sql: string, ...values: unknown[]) =>
    database.prepare(sql).bind(...values);
  async function getSettings(): Promise<WorkspaceSettings> {
    const row = await statement(
      'SELECT * FROM workspace_settings WHERE owner_id = ?',
      ownerId,
    ).first<SettingsRow>();
    return row
      ? {
          name: row.name,
          revision: row.revision,
          policy: JSON.parse(row.policy_json),
          updatedAt: row.updated_at,
        }
      : {
          name: '我的財務工作區',
          revision: 0,
          policy: defaultPolicy,
          updatedAt: '',
        };
  }
  async function updateSettings(value: unknown): Promise<WorkspaceSettings> {
    const input = parseObject(value);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60)
      throw new ApiError('工作區名稱需為 1 至 60 字元。');
    if (!Number.isInteger(input.revision) || Number(input.revision) < 0)
      throw new ApiError('缺少有效的政策版本。');
    const policy = parsePolicy(input.policy);
    const current = await getSettings();
    if (current.revision !== input.revision)
      throw new ConflictError('政策已更新，請重新載入後再儲存。');
    const revision = current.revision + 1;
    const updatedAt = new Date().toISOString();
    try {
      await database.batch([
        statement(
          'INSERT INTO policy_versions (owner_id, revision, policy_json, created_at) VALUES (?, ?, ?, ?)',
          ownerId,
          revision,
          JSON.stringify(policy),
          updatedAt,
        ),
        statement(
          'INSERT INTO workspace_settings (owner_id,name,revision,policy_json,updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET name=excluded.name,revision=excluded.revision,policy_json=excluded.policy_json,updated_at=excluded.updated_at',
          ownerId,
          name,
          revision,
          JSON.stringify(policy),
          updatedAt,
        ),
      ]);
    } catch (error) {
      if ((await getSettings()).revision !== current.revision)
        throw new ConflictError('政策已更新，請重新載入。');
      throw error;
    }
    return { name, revision, policy, updatedAt };
  }
  async function history() {
    const result = await statement(
      'SELECT revision, policy_json, created_at FROM policy_versions WHERE owner_id = ? ORDER BY revision DESC LIMIT 20',
      ownerId,
    ).all<{ revision: number; policy_json: string; created_at: string }>();
    return result.results.map((row) => ({
      revision: row.revision,
      policy: JSON.parse(row.policy_json),
      createdAt: row.created_at,
    }));
  }
  async function consumeMutationLimit(limit = 60) {
    const window = Math.floor(Date.now() / 60_000);
    const row = await statement(
      'INSERT INTO request_limits (owner_id,window,count) VALUES (?, ?, 1) ON CONFLICT(owner_id,window) DO UPDATE SET count=count+1 RETURNING count',
      ownerId,
      window,
    ).first<{ count: number }>();
    if (row && row.count > limit)
      throw new ApiError('操作頻率過高，請稍後再試。', 429, 'HB_RATE_LIMITED');
    await statement(
      'DELETE FROM request_limits WHERE owner_id = ? AND window < ?',
      ownerId,
      window - 2,
    ).run();
  }
  return { getSettings, updateSettings, history, consumeMutationLimit };
}
