export interface AuditRecord {
  id: string;
  system: string;
  promptVersion: string;
  model: string | null;
  sessionId: string | null;
  userId: string | null;
  input: unknown;
  output: unknown;
  confidence: number | null;
  costGbp: number | null;
  latencyMs: number;
  createdAt: string;
  expiresAt: string | null;
  context: Record<string, unknown>;
}

export interface CallEnvelope {
  sessionId?: string;
  userId?: string;
  context?: Record<string, unknown>;
}

export interface ExtractedMetadata {
  model?: string;
  confidence?: number;
  costGbp?: number;
}

export type Extract<TOut> = (output: TOut) => ExtractedMetadata;

export interface QueryFilter {
  since?: string;                    // ISO string OR relative like "24h", "7d"
  until?: string;
  where?: {
    userId?: string;
    sessionId?: string;
    system?: string;
    model?: string;
    confidence?: { lt?: number; gte?: number; lte?: number; gt?: number };
  };
  limit?: number;
}
