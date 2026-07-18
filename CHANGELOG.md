# Changelog

All notable changes to this project are documented here. Follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-07-18

### Added
- Core API: `AuditLog.wrap(fn, opts)` wraps any async LLM-calling function so every call is recorded — system, prompt version, model, session, user, input, output, confidence, cost, latency, timestamps, expiry.
- Query API: `audit.query({ since, until, where, limit })` supporting `since: "24h"` / `"7d"` / ISO strings, and where-clauses over `userId`, `sessionId`, `system`, `model`, and confidence bounds.
- GDPR primitives, first-class: `forgetSession(id)`, `forgetUser(id)`, `pruneExpired()`. All return the number of records removed for DSAR audit evidence.
- Storage adapters: `MemoryStore` (in-process) and `FileStore` (atomic JSON, write-serialised for single-instance deployments).
- Analyst CLI: `audit-log-llm query | show | forget-session | forget-user | prune`.
- Vitest suite (15 tests) covering wrap semantics, extract() metadata pull, retention & expiresAt computation, GDPR erasure by session/user, prune-expired correctness, and query filtering.
- GitHub Actions CI on Node 20 & 22.
