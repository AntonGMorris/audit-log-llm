import { describe, expect, it, vi } from "vitest";

import { AuditLog } from "../src/audit.js";
import { MemoryStore } from "../src/storage/memory.js";

let counter = 0;
const testId = (): string => `a_test${(++counter).toString().padStart(3, "0")}`;

describe("AuditLog.wrap", () => {
  it("records a call with input, output, latency, and timestamps", async () => {
    const storage = new MemoryStore();
    const audit = new AuditLog({ storage, idGen: testId });
    const fn = vi.fn(async (input: { q: string }) => ({ text: `answer to ${input.q}` }));

    const wrapped = audit.wrap(fn, { system: "qa", promptVersion: "v1" });
    const output = await wrapped(
      { sessionId: "sess_1", userId: "u_1" },
      { q: "hello" },
    );

    expect(output.text).toBe("answer to hello");
    const records = await storage.query({});
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.system).toBe("qa");
    expect(rec.promptVersion).toBe("v1");
    expect(rec.sessionId).toBe("sess_1");
    expect(rec.userId).toBe("u_1");
    expect(rec.input).toEqual({ q: "hello" });
    expect(rec.output).toEqual({ text: "answer to hello" });
    expect(rec.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof rec.createdAt).toBe("string");
  });

  it("uses extract() to pull confidence/cost/model from the return value", async () => {
    const audit = new AuditLog({ idGen: testId });
    const fn = async () => ({ text: "hi", confidence: 0.63, cost: 0.0021, model: "haiku-4-5" });
    const wrapped = audit.wrap(fn, {
      system: "qa",
      promptVersion: "v1",
      extract: (o) => ({ confidence: o.confidence, costGbp: o.cost, model: o.model }),
    });

    await wrapped({});
    const [rec] = await audit.query({});
    expect(rec!.confidence).toBe(0.63);
    expect(rec!.costGbp).toBe(0.0021);
    expect(rec!.model).toBe("haiku-4-5");
  });

  it("does not audit errored calls in v0.1", async () => {
    const audit = new AuditLog({ idGen: testId });
    const wrapped = audit.wrap(
      async () => {
        throw new Error("upstream 500");
      },
      { system: "qa", promptVersion: "v1" },
    );

    await expect(wrapped({})).rejects.toThrow(/upstream 500/);
    expect(await audit.query({})).toHaveLength(0);
  });

  it("populates expiresAt when retention is configured", async () => {
    const now = () => new Date("2026-07-18T12:00:00Z");
    const audit = new AuditLog({ retention: { days: 30 }, now, idGen: testId });
    const wrapped = audit.wrap(async () => "ok", { system: "s", promptVersion: "v1" });
    await wrapped({});
    const [rec] = await audit.query({});
    expect(rec!.expiresAt).toBe("2026-08-17T12:00:00.000Z");
  });
});

describe("AuditLog GDPR primitives", () => {
  async function seed(audit: AuditLog): Promise<void> {
    const wrapped = audit.wrap(async () => "out", { system: "s", promptVersion: "v1" });
    await wrapped({ sessionId: "sess_a", userId: "u_1" });
    await wrapped({ sessionId: "sess_a", userId: "u_1" });
    await wrapped({ sessionId: "sess_b", userId: "u_1" });
    await wrapped({ sessionId: "sess_c", userId: "u_2" });
  }

  it("forgetSession removes only the matching session's records", async () => {
    const audit = new AuditLog({ idGen: testId });
    await seed(audit);
    const removed = await audit.forgetSession("sess_a");
    expect(removed).toBe(2);
    expect(await audit.query({})).toHaveLength(2);
  });

  it("forgetUser removes every record for that user across sessions", async () => {
    const audit = new AuditLog({ idGen: testId });
    await seed(audit);
    const removed = await audit.forgetUser("u_1");
    expect(removed).toBe(3);
    const rest = await audit.query({});
    expect(rest).toHaveLength(1);
    expect(rest[0]!.userId).toBe("u_2");
  });

  it("pruneExpired drops records older than retention.days", async () => {
    let clock = new Date("2026-07-01T00:00:00Z").getTime();
    const audit = new AuditLog({
      retention: { days: 30 },
      now: () => new Date(clock),
      idGen: testId,
    });
    const wrapped = audit.wrap(async () => "x", { system: "s", promptVersion: "v1" });

    await wrapped({});                                                // 2026-07-01
    clock = new Date("2026-08-05T00:00:00Z").getTime();               // +35 days
    await wrapped({});
    clock = new Date("2026-08-10T00:00:00Z").getTime();               // +40 days from first record

    const removed = await audit.pruneExpired();
    expect(removed).toBe(1);
    const rest = await audit.query({});
    expect(rest).toHaveLength(1);
    expect(rest[0]!.createdAt.startsWith("2026-08-05")).toBe(true);
  });

  it("pruneExpired is a no-op without retention configured", async () => {
    const audit = new AuditLog({ idGen: testId });
    const wrapped = audit.wrap(async () => "x", { system: "s", promptVersion: "v1" });
    await wrapped({});
    expect(await audit.pruneExpired()).toBe(0);
    expect(await audit.query({})).toHaveLength(1);
  });
});
