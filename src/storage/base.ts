import type { AuditRecord, QueryFilter } from "../types.js";

export interface AuditStore {
  append(record: AuditRecord): Promise<void>;
  get(id: string): Promise<AuditRecord | undefined>;
  query(filter: QueryFilter): Promise<AuditRecord[]>;
  deleteWhere(predicate: (r: AuditRecord) => boolean): Promise<number>;
}
