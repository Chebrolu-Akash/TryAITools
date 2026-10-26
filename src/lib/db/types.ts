// Minimal structural types for the parts of Cloudflare D1 we use, so the code type-checks and is
// testable without @cloudflare/workers-types. The real D1Database satisfies these.
export type D1RunResult = { success: boolean; meta?: { changes?: number } };
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success?: boolean }>;
  run(): Promise<D1RunResult>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}
