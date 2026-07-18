import { randomBytes } from "node:crypto";

import { MemoryStore } from "./storage/memory.js";
import type { AuditStore } from "./storage/base.js";
import { resolveTime } from "./storage/match.js";
import type {
  AuditRecord,
  CallEnvelope,
  Extract,
  ExtractedMetadata,
  QueryFilter,
} from "./types.js";

export interface AuditLogOptions {
  /** Where records live. Defaults to a MemoryStore. */
  storage?: AuditStore;
  /** Retention window. Records older than this are eligible for pruneExpired(). */
  retention?: { days: number };
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable id generator for tests. */
  idGen?: () => string;
}

export interface WrapOptions<TOut> {
  /** Logical system name — usually your agent name. */
  system: string;
  /** Version string for the prompt template — bump when you change wording. */
  promptVersion: string;
  /**
   * Optional model name if it isn't in the return value. Extract takes precedence.
   */
  model?: string;
  /**
   * Pull confidence / cost / model from the return value. If your model returns
   * `{ text, confidence, cost }`, an extract function makes the audit record
   * richer without changing your call sites.
   */
  extract?: Extract<TOut>;
}

export class AuditLog {
  private readonly storage: AuditStore;
  private readonly retentionMs: number | null;
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(opts: AuditLogOptions = {}) {
    this.storage = opts.storage ?? new MemoryStore();
    this.retentionMs = opts.retention ? opts.retention.days * 86_400_000 : null;
    this.now = opts.now ?? (() => new Date());
    this.idGen = opts.idGen ?? defaultId;
  }

  /**
   * Wrap an async LLM-calling function so every call is audited. The wrapped
   * function takes a `CallEnvelope` as its first argument, then whatever the
   * underlying function expects.
   */
  wrap<TArgs extends unknown[], TOut>(
    fn: (...args: TArgs) => Promise<TOut>,
    opts: WrapOptions<TOut>,
  ): (envelope: CallEnvelope, ...args: TArgs) => Promise<TOut> {
    return async (envelope: CallEnvelope, ...args: TArgs): Promise<TOut> => {
      const started = performance.now();
      let output: TOut;
      try {
        output = await fn(...args);
      } catch (err) {
        // We deliberately don't log errored calls in v0.1 — the wrapped
        // function's caller sees the error and can handle it. v0.2 will
        // add an error-record mode behind a flag.
        throw err;
      }
      const latencyMs = Math.round(performance.now() - started);

      const extracted: ExtractedMetadata = opts.extract ? opts.extract(output) : {};
      const record = this.buildRecord({
        envelope,
        args,
        output,
        latencyMs,
        system: opts.system,
        promptVersion: opts.promptVersion,
        fallbackModel: opts.model,
        extracted,
      });
      await this.storage.append(record);
      return output;
    };
  }

  async query(filter: QueryFilter = {}): Promise<AuditRecord[]> {
    return this.storage.query(filter);
  }

  async get(id: string): Promise<AuditRecord | undefined> {
    return this.storage.get(id);
  }

  /** Right-to-erasure for one session. Returns number of records removed. */
  async forgetSession(sessionId: string): Promise<number> {
    return this.storage.deleteWhere((r) => r.sessionId === sessionId);
  }

  /** Right-to-erasure for one user across all their sessions. */
  async forgetUser(userId: string): Promise<number> {
    return this.storage.deleteWhere((r) => r.userId === userId);
  }

  /**
   * Drop records past retention. Safe to call regularly (cron / scheduled task).
   * Returns number of records removed.
   */
  async pruneExpired(): Promise<number> {
    if (this.retentionMs === null) return 0;
    const cutoff = resolveTime(this.now().toISOString(), this.now().getTime()) - this.retentionMs;
    return this.storage.deleteWhere((r) => Date.parse(r.createdAt) < cutoff);
  }

  private buildRecord(args: {
    envelope: CallEnvelope;
    args: unknown[];
    output: unknown;
    latencyMs: number;
    system: string;
    promptVersion: string;
    fallbackModel: string | undefined;
    extracted: ExtractedMetadata;
  }): AuditRecord {
    const createdAtDate = this.now();
    const createdAt = createdAtDate.toISOString();
    const expiresAt =
      this.retentionMs === null
        ? null
        : new Date(createdAtDate.getTime() + this.retentionMs).toISOString();

    return {
      id: this.idGen(),
      system: args.system,
      promptVersion: args.promptVersion,
      model: args.extracted.model ?? args.fallbackModel ?? null,
      sessionId: args.envelope.sessionId ?? null,
      userId: args.envelope.userId ?? null,
      // input is the first user-supplied arg — capture verbatim.
      input: args.args[0] ?? null,
      output: args.output,
      confidence: args.extracted.confidence ?? null,
      costGbp: args.extracted.costGbp ?? null,
      latencyMs: args.latencyMs,
      createdAt,
      expiresAt,
      context: args.envelope.context ?? {},
    };
  }
}

function defaultId(): string {
  return "a_" + randomBytes(4).toString("hex");
}
