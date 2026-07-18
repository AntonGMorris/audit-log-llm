import type { AuditRecord, QueryFilter } from "../types.js";

/**
 * Shared filter matcher used by both MemoryStore and FileStore. Keeps the
 * query semantics identical across backends.
 */
export function matches(record: AuditRecord, filter: QueryFilter): boolean {
  const now = Date.now();

  if (filter.since) {
    const since = resolveTime(filter.since, now);
    if (Date.parse(record.createdAt) < since) return false;
  }
  if (filter.until) {
    const until = resolveTime(filter.until, now);
    if (Date.parse(record.createdAt) > until) return false;
  }

  const w = filter.where;
  if (!w) return true;

  if (w.userId !== undefined && record.userId !== w.userId) return false;
  if (w.sessionId !== undefined && record.sessionId !== w.sessionId) return false;
  if (w.system !== undefined && record.system !== w.system) return false;
  if (w.model !== undefined && record.model !== w.model) return false;

  if (w.confidence) {
    const c = record.confidence;
    if (c === null) return false;
    if (w.confidence.lt !== undefined && !(c < w.confidence.lt)) return false;
    if (w.confidence.lte !== undefined && !(c <= w.confidence.lte)) return false;
    if (w.confidence.gt !== undefined && !(c > w.confidence.gt)) return false;
    if (w.confidence.gte !== undefined && !(c >= w.confidence.gte)) return false;
  }

  return true;
}

/**
 * Accepts either an ISO timestamp or a relative window like "24h", "7d",
 * "30m". Anything else falls back to Date.parse.
 */
export function resolveTime(input: string, nowMs: number): number {
  const relative = /^(\d+)([smhdw])$/.exec(input);
  if (relative) {
    const [, amount, unit] = relative;
    const n = Number(amount);
    switch (unit) {
      case "s": return nowMs - n * 1000;
      case "m": return nowMs - n * 60_000;
      case "h": return nowMs - n * 3_600_000;
      case "d": return nowMs - n * 86_400_000;
      case "w": return nowMs - n * 7 * 86_400_000;
    }
  }
  return Date.parse(input);
}
