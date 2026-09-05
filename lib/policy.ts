import { ApiError } from './errors.ts';

export type RiskPolicy = {
  liquidityFloor: number;
  openingLiquidity: number;
  twdPerUsd: number;
  usdcUsd: number;
  herdThreshold: number;
  concentrationThreshold: number;
  maxIntentUsd: number;
};
export const defaultPolicy: RiskPolicy = {
  liquidityFloor: 75,
  openingLiquidity: 32_000_000,
  twdPerUsd: 32,
  usdcUsd: 1,
  herdThreshold: 70,
  concentrationThreshold: 50,
  maxIntentUsd: 1_000_000,
};
export type WorkspaceSettings = {
  name: string;
  revision: number;
  policy: RiskPolicy;
  updatedAt: string;
};
export function parsePolicy(value: unknown): RiskPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('政策設定必須是物件。');
  const object = value as Record<string, unknown>;
  const ranges: Record<keyof RiskPolicy, [number, number]> = {
    liquidityFloor: [50, 95],
    openingLiquidity: [1000, 1_000_000_000_000],
    twdPerUsd: [1, 1000],
    usdcUsd: [0.01, 10],
    herdThreshold: [50, 100],
    concentrationThreshold: [10, 100],
    maxIntentUsd: [1, 1_000_000_000],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = object[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new ApiError(`${key} 必須介於 ${min} 與 ${max}。`);
  }
  if (!Number.isInteger(object.liquidityFloor))
    throw new ApiError('資金緩衝底線必須是整數。');
  return Object.fromEntries(
    Object.keys(ranges).map((key) => [key, object[key]]),
  ) as RiskPolicy;
}
