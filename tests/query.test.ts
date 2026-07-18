import { describe, expect, it } from "vitest";

import { MemoryStore } from "../src/storage/memory.js";
import { matches, resolveTime } from "../src/storage/match.js";
import type { AuditRecord } from "../src/types.js";

function rec(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "a_1",
    system: "qa",
    promptVersion: "v1",
    model: "haiku-4-5",
    sessionId: null,
    userId: null,
    input: null,
    output: null,
    confidence: null,
    costGbp: null,
    latencyMs: 0,
    createdAt: "2026-07-18T12:00:00.000Z",
    expiresAt: null,
    context: {},
    ...overrides,
  };
}

describe("resolveTime", () => {
  it("parses relative windows", () => {
    const now = Date.parse("2026-07-18T12:00:00Z");
    expect(resolveTime("24h", now)).toBe(now - 86_400_000);
    expect(resolveTime("30m", now)).toBe(now - 1_800_000);
    expect(resolveTime("7d", now)).toBe(now - 7 * 86_400_000);
    expect(resolveTime("2w", now)).toBe(now - 14 * 86_400_000);
  });

  it("falls back to Date.parse for ISO strings", () => {
    const now = Date.now();
    expect(resolveTime("2026-01-01T00:00:00Z", now)).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });
});

describe("matches", () => {
  it("filters by since", () => {
    const now = Date.parse("2026-07-18T12:00:00Z");
    const old = rec({ createdAt: "2026-06-01T00:00:00.000Z" });
    const fresh = rec({ createdAt: "2026-07-18T11:59:00.000Z" });
    const nowFn = (): number => now;
    // 1h window
    expect(matchesAt(old, { since: "1h" }, nowFn)).toBe(false);
    expect(matchesAt(fresh, { since: "1h" }, nowFn)).toBe(true);
  });

  it("filters by confidence lt", () => {
    expect(matches(rec({ confidence: 0.5 }), { where: { confidence: { lt: 0.7 } } })).toBe(true);
    expect(matches(rec({ confidence: 0.9 }), { where: { confidence: { lt: 0.7 } } })).toBe(false);
    expect(matches(rec({ confidence: null }), { where: { confidence: { lt: 0.7 } } })).toBe(false);
  });

  it("combines where filters as AND", () => {
    const r = rec({ userId: "u_1", system: "qa", confidence: 0.5 });
    expect(
      matches(r, { where: { userId: "u_1", system: "qa", confidence: { lt: 0.7 } } }),
    ).toBe(true);
    expect(
      matches(r, { where: { userId: "u_1", system: "other", confidence: { lt: 0.7 } } }),
    ).toBe(false);
  });
});

describe("MemoryStore.query", () => {
  it("returns most-recent first", async () => {
    const store = new MemoryStore();
    await store.append(rec({ id: "a1", createdAt: "2026-07-18T10:00:00.000Z" }));
    await store.append(rec({ id: "a2", createdAt: "2026-07-18T12:00:00.000Z" }));
    await store.append(rec({ id: "a3", createdAt: "2026-07-18T11:00:00.000Z" }));

    const all = await store.query({});
    expect(all.map((r) => r.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("respects limit", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 5; i++) {
      await store.append(rec({ id: `a${i}`, createdAt: `2026-07-18T10:0${i}:00.000Z` }));
    }
    const two = await store.query({ limit: 2 });
    expect(two).toHaveLength(2);
  });
});

// Small helper because matches() reads Date.now() implicitly for relative windows.
function matchesAt(r: AuditRecord, f: Parameters<typeof matches>[1], nowFn: () => number): boolean {
  const orig = Date.now;
  Date.now = nowFn;
  try {
    return matches(r, f);
  } finally {
    Date.now = orig;
  }
}
