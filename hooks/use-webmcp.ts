'use client';

import { useEffect, useRef } from 'react';
import { parseObject, parseReleaseCount, parseRunInput } from '@/lib/contracts';
import type { StoredRun } from '@/lib/contracts';
import { scenarios } from '@/lib/herdbrake';
import type { RiskResult, ScenarioId } from '@/lib/herdbrake';

type ModelContext = {
  registerTool: (
    tool: unknown,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};
declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

type Options = {
  risk: RiskResult;
  runId: string | null;
  floor: number;
  runScenario: (id: ScenarioId, severity: number) => Promise<StoredRun>;
  onLaunch: () => void;
  onPrepare: (count: number) => void;
};
export function useWebMCP(options: Options) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: 'run_herdbrake_stress_test',
        title: 'Run treasury stress test',
        description:
          'Persist a deterministic stress test and open its visible result.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scenarioId: { type: 'string', enum: scenarios.map((s) => s.id) },
            severity: { type: 'number', minimum: 0.1, maximum: 1 },
          },
          required: ['scenarioId', 'severity'],
        },
        execute: async (value: unknown) => {
          const input = parseRunInput({
            ...parseObject(value),
            liquidityFloor: latest.current.floor,
          });
          latest.current.onLaunch();
          const run = await latest.current.runScenario(
            input.scenarioId,
            input.severity,
          );
          return {
            runId: run.runId,
            scenarioId: run.scenarioId,
            severity: run.severity,
            status: 'persisted',
          };
        },
      },
      {
        name: 'prepare_herdbrake_release',
        title: 'Prepare safe payment release',
        description:
          'Open the visible review for a human. This tool cannot authorize or release intents.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { count: { type: 'integer', minimum: 1, maximum: 10 } },
          required: ['count'],
        },
        execute: (value: unknown) => {
          const count = parseReleaseCount(parseObject(value).count);
          latest.current.onLaunch();
          latest.current.onPrepare(count);
          return {
            proposedCount: count,
            authorization: 'human-required',
            persisted: false,
            fundsMoved: false,
          };
        },
      },
      {
        name: 'get_herdbrake_risk_state',
        title: 'Read aggregate risk state',
        description:
          'Read the current result without changing it. persisted=false indicates a sample preview.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const { risk, runId } = latest.current;
          return {
            runId,
            persisted: Boolean(runId),
            state: risk.state,
            directionalAgreement: risk.directionalAgreement,
            projectedBuffer: risk.projectedBuffer,
            reasonCode: risk.reasonCode,
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => undefined);
      } catch {
        /* Browsers without this optional API retain the human workflow. */
      }
    }
    return () => lifecycle.abort();
  }, []);
}
