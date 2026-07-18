#!/usr/bin/env node
import { AuditLog } from "./audit.js";
import { FileStore } from "./storage/file.js";
import type { QueryFilter } from "./types.js";

const DEFAULT_DB = process.env.AUDIT_DB ?? "./audit.db.json";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const audit = new AuditLog({ storage: new FileStore(DEFAULT_DB) });

  switch (command) {
    case "query":
      return queryCmd(audit, parseArgs(rest));
    case "show":
      return showCmd(audit, rest);
    case "forget-session":
      return forgetSessionCmd(audit, rest);
    case "forget-user":
      return forgetUserCmd(audit, rest);
    case "prune":
      return pruneCmd(audit);
    default:
      console.error(`unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`audit-log-llm — query + GDPR CLI

Usage:
  audit-log-llm query [--since 24h] [--user ID] [--session ID] [--system NAME]
                      [--confidence-lt N] [--confidence-gte N] [--limit N]
  audit-log-llm show <id>
  audit-log-llm forget-session <sessionId>
  audit-log-llm forget-user <userId>
  audit-log-llm prune

Storage path: AUDIT_DB env (default: ./audit.db.json)
`);
}

async function queryCmd(audit: AuditLog, args: Record<string, string>): Promise<void> {
  const filter: QueryFilter = {
    since: args.since ?? "24h",
    limit: args.limit ? Number(args.limit) : 50,
    where: {},
  };
  if (args.user) filter.where!.userId = args.user;
  if (args.session) filter.where!.sessionId = args.session;
  if (args.system) filter.where!.system = args.system;
  if (args["confidence-lt"]) filter.where!.confidence = { lt: Number(args["confidence-lt"]) };
  if (args["confidence-gte"]) {
    filter.where!.confidence = {
      ...(filter.where!.confidence ?? {}),
      gte: Number(args["confidence-gte"]),
    };
  }

  const records = await audit.query(filter);
  if (records.length === 0) {
    console.log("no records matched");
    return;
  }
  console.log(`id           system              conf     £/call    latency   created`);
  console.log(`-----------  ------------------  -------  --------  --------  --------------------`);
  for (const r of records) {
    console.log(
      `${r.id.padEnd(11)}  ${r.system.slice(0, 18).padEnd(18)}  ${fmt(r.confidence).padStart(7)}  ${fmt(r.costGbp, 4).padStart(8)}  ${(r.latencyMs + "ms").padStart(8)}  ${r.createdAt}`,
    );
  }
  console.log(`\n${records.length} record${records.length === 1 ? "" : "s"}`);
}

async function showCmd(audit: AuditLog, positional: string[]): Promise<void> {
  const id = firstPositional(positional);
  const record = await audit.get(id);
  if (!record) {
    console.error(`no record with id ${id}`);
    process.exit(1);
  }
  console.log(JSON.stringify(record, null, 2));
}

async function forgetSessionCmd(audit: AuditLog, positional: string[]): Promise<void> {
  const sessionId = firstPositional(positional);
  const removed = await audit.forgetSession(sessionId);
  console.log(`forgot session ${sessionId}: removed ${removed} record${removed === 1 ? "" : "s"}`);
}

async function forgetUserCmd(audit: AuditLog, positional: string[]): Promise<void> {
  const userId = firstPositional(positional);
  const removed = await audit.forgetUser(userId);
  console.log(`forgot user ${userId}: removed ${removed} record${removed === 1 ? "" : "s"}`);
}

async function pruneCmd(audit: AuditLog): Promise<void> {
  const removed = await audit.pruneExpired();
  console.log(`pruned ${removed} expired record${removed === 1 ? "" : "s"}`);
}

function fmt(value: number | null, decimals = 2): string {
  return value === null ? "—" : value.toFixed(decimals);
}

function firstPositional(tokens: string[]): string {
  const id = tokens.find((t) => !t.startsWith("--"));
  if (!id) {
    console.error("missing id argument");
    process.exit(1);
  }
  return id;
}

function parseArgs(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = tokens[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("audit-log-llm:", message);
  process.exit(1);
});
