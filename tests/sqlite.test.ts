import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore } from "../src/storage/file.js";
import { openStore, sqliteAvailable, SqliteStore } from "../src/storage/index.js";
import type { AuditRecord } from "../src/types.js";

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "a_1",
    system: "test-system",
    promptVersion: "v1",
    model: "claude-haiku-4-5",
    sessionId: "sess_1",
    userId: "u_1",
    input: { prompt: "hello" },
    output: { text: "world" },
    confidence: 0.9,
    costGbp: 0.001,
    latencyMs: 500,
    createdAt: "2026-07-18T12:00:00.000Z",
    expiresAt: null,
    context: {},
    ...overrides,
  };
}

describe.skipIf(!sqliteAvailable())("SqliteStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "audit-sqlite-test-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("persists across instances", async () => {
    const file = path.join(dir, "audit.db");
    const s1 = new SqliteStore(file);
    await s1.append(record({ id: "a_persist" }));
    s1.close();

    const s2 = new SqliteStore(file);
    const got = await s2.get("a_persist");
    expect(got?.id).toBe("a_persist");
    s2.close();
  });

  it("round-trips all fields including JSON and nulls", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    const rec = record({
      id: "a_full",
      model: null,
      sessionId: null,
      userId: null,
      confidence: null,
      costGbp: null,
      input: { nested: { deep: [1, 2, 3] } },
      output: "plain string output",
      context: { temperature: 0.7, tags: ["a", "b"] },
      expiresAt: "2026-08-17T12:00:00.000Z",
    });
    await s.append(rec);
    const got = await s.get("a_full");
    expect(got).toEqual(rec);
    s.close();
  });

  it("returns undefined for missing ids", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    expect(await s.get("nope")).toBeUndefined();
    s.close();
  });

  it("queries with since window (relative)", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    const recent = new Date(Date.now() - 3_600_000).toISOString();
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await s.append(record({ id: "a_recent", createdAt: recent }));
    await s.append(record({ id: "a_old", createdAt: old }));
    const got = await s.query({ since: "24h" });
    expect(got.map((r) => r.id)).toEqual(["a_recent"]);
    s.close();
  });

  it("filters by userId / sessionId / system / model", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    await s.append(record({ id: "a_1", userId: "u_1", system: "alpha" }));
    await s.append(record({ id: "a_2", userId: "u_2", system: "beta" }));
    expect((await s.query({ where: { userId: "u_2" } })).map((r) => r.id)).toEqual(["a_2"]);
    expect((await s.query({ where: { system: "alpha" } })).map((r) => r.id)).toEqual(["a_1"]);
    s.close();
  });

  it("filters by confidence range and excludes null confidence", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    await s.append(record({ id: "a_low", confidence: 0.4 }));
    await s.append(record({ id: "a_high", confidence: 0.95 }));
    await s.append(record({ id: "a_null", confidence: null }));
    const low = await s.query({ where: { confidence: { lt: 0.7 } } });
    expect(low.map((r) => r.id)).toEqual(["a_low"]);
    s.close();
  });

  it("orders by createdAt DESC and applies limit", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    await s.append(record({ id: "a_1", createdAt: "2026-07-18T10:00:00.000Z" }));
    await s.append(record({ id: "a_3", createdAt: "2026-07-18T12:00:00.000Z" }));
    await s.append(record({ id: "a_2", createdAt: "2026-07-18T11:00:00.000Z" }));
    const got = await s.query({ limit: 2 });
    expect(got.map((r) => r.id)).toEqual(["a_3", "a_2"]);
    s.close();
  });

  it("deleteWhere applies the JS predicate and returns count", async () => {
    const s = new SqliteStore(path.join(dir, "audit.db"));
    await s.append(record({ id: "a_1", userId: "u_gone" }));
    await s.append(record({ id: "a_2", userId: "u_gone" }));
    await s.append(record({ id: "a_3", userId: "u_stays" }));
    const removed = await s.deleteWhere((r) => r.userId === "u_gone");
    expect(removed).toBe(2);
    expect((await s.query({})).map((r) => r.id)).toEqual(["a_3"]);
    s.close();
  });
});

describe("openStore", () => {
  it("opens FileStore for .json paths", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "audit-open-test-"));
    const s = openStore(path.join(dir, "audit.json"));
    expect(s).toBeInstanceOf(FileStore);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!sqliteAvailable())("opens SqliteStore for .db paths", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "audit-open-test-"));
    const s = openStore(path.join(dir, "audit.db"));
    expect(s).toBeInstanceOf(SqliteStore);
    (s as SqliteStore).close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
