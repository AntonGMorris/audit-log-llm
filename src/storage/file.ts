import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AuditRecord, QueryFilter } from "../types.js";
import type { AuditStore } from "./base.js";
import { matches } from "./match.js";

interface FileData {
  version: 1;
  records: AuditRecord[];
}

/**
 * Atomic JSON-file audit store. Reads the whole file on every query — fine up
 * to tens of thousands of records, swap for the Postgres backend in v0.2 for
 * higher throughput.
 */
export class FileStore implements AuditStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async append(record: AuditRecord): Promise<void> {
    await this.enqueue(async () => {
      const data = await this.read();
      data.records.push({ ...record });
      await this.write(data);
    });
  }

  async get(id: string): Promise<AuditRecord | undefined> {
    const data = await this.read();
    const rec = data.records.find((r) => r.id === id);
    return rec ? { ...rec } : undefined;
  }

  async query(filter: QueryFilter): Promise<AuditRecord[]> {
    const data = await this.read();
    const filtered = data.records.filter((r) => matches(r, filter));
    const sorted = filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const limited = filter.limit ? sorted.slice(0, filter.limit) : sorted;
    return limited.map((r) => ({ ...r }));
  }

  async deleteWhere(predicate: (r: AuditRecord) => boolean): Promise<number> {
    let removed = 0;
    await this.enqueue(async () => {
      const data = await this.read();
      const before = data.records.length;
      data.records = data.records.filter((r) => !predicate(r));
      removed = before - data.records.length;
      await this.write(data);
    });
    return removed;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<FileData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileData;
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error(`unrecognised store schema at ${this.filePath}`);
      }
      return parsed;
    } catch (err: unknown) {
      if (isMissingFileError(err)) return { version: 1, records: [] };
      throw err;
    }
  }

  private async write(data: FileData): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}

function isMissingFileError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
