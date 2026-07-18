import type { AuditRecord, QueryFilter } from "../types.js";
import type { AuditStore } from "./base.js";
import { matches } from "./match.js";

export class MemoryStore implements AuditStore {
  private readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async get(id: string): Promise<AuditRecord | undefined> {
    const rec = this.records.find((r) => r.id === id);
    return rec ? { ...rec } : undefined;
  }

  async query(filter: QueryFilter): Promise<AuditRecord[]> {
    const filtered = this.records.filter((r) => matches(r, filter));
    const sorted = filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const limited = filter.limit ? sorted.slice(0, filter.limit) : sorted;
    return limited.map((r) => ({ ...r }));
  }

  async deleteWhere(predicate: (r: AuditRecord) => boolean): Promise<number> {
    let removed = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (predicate(this.records[i]!)) {
        this.records.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}
