import type { HashAuditEvent } from './assurance-core.ts';

const titles: Record<string, string> = {
  SCENARIO_RECEIVED: '批次資料已接收',
  INTENTS_EVALUATED: '付款意圖已評估',
  BREAKER_TRIGGERED: '聚合風險警示已觸發',
  BATCH_REVIEWED: '整批風險評估完成',
  STAGED_RELEASE_AUTHORIZED: '付款意圖已核准',
  REPLAY_BLOCKED: '重複付款識別碼已拒絕',
};
export function presentAuditEvent(event: HashAuditEvent) {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  const value = (key: string) =>
    typeof detail[key] === 'string' || typeof detail[key] === 'number'
      ? String(detail[key])
      : '—';
  let description = '已保存的稽核事件';
  switch (event.eventType) {
    case 'SCENARIO_RECEIVED':
      description = value('source');
      break;
    case 'INTENTS_EVALUATED':
      description = `${value('count')} 筆付款意圖 · 欄位政策 ${detail.individualPass ? 'PASS' : 'REVIEW'}`;
      break;
    case 'BREAKER_TRIGGERED':
    case 'BATCH_REVIEWED':
      description = `${value('state')} · ${value('reasonCode')}`;
      break;
    case 'STAGED_RELEASE_AUTHORIZED':
      description = `${Array.isArray(detail.releasedIntentIds) ? detail.releasedIntentIds.length : 0} 筆 · ${value('authorizationReason')} · ${value('remainingHeld')} 筆仍待審核`;
      break;
    case 'REPLAY_BLOCKED':
      description = `${value('nonce')} 已存在 · 未移動資金`;
      break;
  }
  return {
    time: new Date(event.createdAt).toLocaleTimeString('en-GB', {
      hour12: false,
      timeZone: 'Asia/Taipei',
    }),
    title: titles[event.eventType] ?? event.eventType.replaceAll('_', ' '),
    detail: description,
    tone:
      event.eventType === 'BREAKER_TRIGGERED'
        ? ('danger' as const)
        : ['REPLAY_BLOCKED', 'STAGED_RELEASE_AUTHORIZED'].includes(
              event.eventType,
            )
          ? ('safe' as const)
          : ('neutral' as const),
  };
}
