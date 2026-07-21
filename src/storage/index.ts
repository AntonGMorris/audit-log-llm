import { FileStore } from "./file.js";
import { SqliteStore } from "./sqlite.js";
import type { AuditStore } from "./base.js";

export { FileStore } from "./file.js";
export { MemoryStore } from "./memory.js";
export { SqliteStore, sqliteAvailable } from "./sqlite.js";
export type { AuditStore } from "./base.js";

/** Pick a backend by file extension: `.json` → FileStore, anything else (`.db`, `.sqlite`) → SqliteStore. */
export function openStore(dbPath: string): AuditStore {
  return dbPath.endsWith(".json") ? new FileStore(dbPath) : new SqliteStore(dbPath);
}
