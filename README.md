# audit-log-llm

[![CI](https://github.com/AntonGMorris/audit-log-llm/actions/workflows/ci.yml/badge.svg)](https://github.com/AntonGMorris/audit-log-llm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Structured audit logging for LLM calls. GDPR-friendly, queryable, one weekend to add.**

Wrap any LLM call with one function. Every call — model, prompt version, input, output, confidence, cost, session, user, timestamp — lands in a structured store you own. Query it, filter it, export it, or wipe a customer's data on demand. Zero native dependencies, works out of the box, self-hosts anywhere Node runs.

> **Status: v0.2.** Core wrapper, in-memory + JSON-file + **SQLite** storage, query API with indexed SQL filtering, GDPR erasure by session/user, retention pruning, reviewer CLI. Postgres backend and a Next.js query UI on the roadmap.

---

## Why

Every commercial LLM observability platform charges £50–£500/mo per project and sends your customer data through their servers — usually US-hosted. That's a hard no for UK regulated industries (legal, healthcare, finance, government). Teams end up rolling their own logging poorly — usually missing the GDPR primitives (retention, right-to-erasure) that turn "we log everything" from an asset into a liability the first time a DSAR lands.

`audit-log-llm` is a small library that does the boring plumbing properly: a one-line wrap, a structured record per call, a query API, and GDPR primitives built in from day one. Self-hosted. Your data never leaves your infrastructure.

## Install

```bash
npm install github:AntonGMorris/audit-log-llm
```

_Publishing to npm as `@antonmorris/audit-log-llm` is planned — for now use the git URL above, which npm installs directly from GitHub._

Requires Node.js 20+.

## Quick start

```ts
import { AuditLog, FileStore } from "@antonmorris/audit-log-llm";

const audit = new AuditLog({
  storage: new FileStore("./audit.db.json"),
  retention: { days: 30 },
});

// Wrap any async function that calls an LLM.
const generateEmail = audit.wrap(model.generate, {
  system: "email-drafter",
  promptVersion: "v3",
});

// Call it as normal — with a small metadata envelope for GDPR primitives.
const output = await generateEmail(
  { sessionId: "sess_xyz", userId: "u_123" },
  { prompt: "Draft a reply..." },
);
```

That's it. Every call is now audited. Query later:

```ts
const lowConf = await audit.query({
  where: { confidence: { lt: 0.7 } },
  since: "24h",
});

const forOneCustomer = await audit.query({
  where: { userId: "u_123" },
});
```

## GDPR primitives

Every serious deployment needs these on day one — not "we'll add it before launch":

```ts
// Right-to-erasure by session
await audit.forgetSession("sess_xyz");

// Right-to-erasure by user (all their sessions)
await audit.forgetUser("u_123");

// Retention pruning (drops anything older than retention.days)
const dropped = await audit.pruneExpired();
```

`forgetSession` and `forgetUser` return the number of records removed so you can log it back to your DSAR ticket for evidence of completion.

## The reviewer / analyst CLI

```bash
# List recent records (defaults to last 24h)
npx audit-log-llm query

# Filter by confidence
npx audit-log-llm query --confidence-lt 0.7

# Filter by user
npx audit-log-llm query --user u_123

# Show one record in full
npx audit-log-llm show <id>

# GDPR erasure from the terminal (for one-off DSARs)
npx audit-log-llm forget-session sess_xyz
npx audit-log-llm forget-user u_123

# Prune expired records manually (usually you'd cron this)
npx audit-log-llm prune
```

Storage path defaults to `./audit.db.json` or `AUDIT_DB` env.

## Example — the analyst CLI

```
$ npx audit-log-llm query --confidence-lt 0.7 --since 24h
id           system              conf     £/call    latency   created
-----------  ------------------  -------  --------  --------  --------------------
a_9k2f7a     email-drafter          0.62    0.0021    843ms   2026-07-18T14:22:05Z
a_8mp3b1     support-summariser     0.58    0.0018    712ms   2026-07-18T13:04:57Z
a_7nq0c8     invoice-extractor      0.68    0.0024   1102ms   2026-07-18T11:47:22Z

3 records

$ npx audit-log-llm forget-user u_123
forgot user u_123: removed 47 records
```

Point a DSAR response at the `forget-user` output line — you now have literal audit evidence that the erasure completed and how many records it covered.

## What a record looks like

```json
{
  "id": "a_9k2f7a",
  "system": "email-drafter",
  "promptVersion": "v3",
  "model": "claude-haiku-4-5",
  "sessionId": "sess_xyz",
  "userId": "u_123",
  "input": { "prompt": "Draft a reply..." },
  "output": { "text": "Hi Bethan..." },
  "confidence": 0.72,
  "costGbp": 0.0021,
  "latencyMs": 843,
  "createdAt": "2026-07-18T14:22:05.113Z",
  "expiresAt": "2026-08-17T14:22:05.113Z",
  "context": { "temperature": 0.7 }
}
```

The wrapper reads confidence, cost, latency, and model name from the return value if present, or you can pass an `extract` function to pull them from your model's response shape.

## Storage adapters

Three ship built-in:

- **`MemoryStore`** — everything in-process. Fine for tests and single-run scripts.
- **`FileStore("./audit.db.json")`** — atomic JSON file with per-write flush. Good for single-instance deployments up to a few tens of thousands of records.
- **`SqliteStore("./audit.db")`** — real database persistence via Node's built-in `node:sqlite` (Node ≥ 22.5). WAL mode, and queries compile to indexed SQL (`created_at`, `user_id`, `session_id`, `system`) instead of scanning every record. Still zero dependencies — nothing native to compile.

The CLI picks the backend by extension: `.json` → FileStore, `.db`/`.sqlite` → SqliteStore. Set `AUDIT_DB=./audit.db` and you're on SQLite. In code, `openStore(path)` does the same.

Bring your own by implementing the `AuditStore` interface (four methods: `append`, `get`, `query`, `deleteWhere`). Postgres adapter lands in a future release.

## Roadmap

- **v0.3** — Postgres storage adapter for multi-instance deployments. Same interface — swap without touching your call sites.
- **v0.4** — Query UI. Same data, browser instead of terminal.
- **v0.5** — Export presets — CSV, JSON, and a purpose-built GDPR subject-report format that satisfies most DSAR responses out of the box.
- **v0.6** — Cost aggregation views (£ per user, per system, per day) and per-model breakdowns.

## Honest caveats

- The `FileStore` reads the whole file for each query — fine up to tens of thousands of records. Switch to `SqliteStore` beyond that; multi-instance across hosts still wants the Postgres backend (v0.3).
- `SqliteStore` needs Node ≥ 22.5 (it uses the built-in `node:sqlite`). On Node 20, use `FileStore`.
- No built-in UI yet. Query from the CLI or build on top of `AuditStore`.
- Wrapping a function is only as good as the extract function. If your model returns unusual metadata, pass `extract` explicitly.

## Part of the AI-governance stack

This repo is one of five that ship together as a coherent AI-governance stack. Each is standalone; they compose.

| Repo | What it is |
|---|---|
| [`companies-house-mcp`](https://github.com/AntonGMorris/companies-house-mcp) | Production-grade MCP server for the UK Companies House API. |
| [`prompt-injection-lab`](https://github.com/AntonGMorris/prompt-injection-lab) | Automated red-team suite. Fires known injection payloads at any AI endpoint. |
| [`hitl-review`](https://github.com/AntonGMorris/hitl-review) | Drop-in human-in-the-loop review queue. |
| [`audit-log-llm`](https://github.com/AntonGMorris/audit-log-llm) | **You are here.** GDPR-friendly structured audit logging for LLM calls. |
| [`lead-qual-agent`](https://github.com/AntonGMorris/lead-qual-agent) | Example agent that composes all of the above. |

Built and maintained by [Anton Morris](https://antonmorris.co.uk).

## License

MIT. See `LICENSE`.
