import type { D1DatabaseLike } from "./types";

export type EnvSource = "server-entry" | "cloudflare:workers" | "none";
let captured: Record<string, unknown> | null = null;

/** Called from src/server.ts with the Worker `env` argument, when the runtime passes one. */
export function captureRuntimeEnv(env: unknown) {
  if (env && typeof env === "object") captured = env as Record<string, unknown>;
}

const isD1 = (v: unknown): v is D1DatabaseLike => !!v && typeof (v as D1DatabaseLike).prepare === "function";

/**
 * Finds the D1 binding named DB. Tries the env captured by the server entry first, then the
 * `cloudflare:workers` module. Returns which path worked so the preview check can report it.
 * Never throws: a missing binding simply means "no database" and callers fall back to JSON.
 */
export async function getD1(): Promise<{ db: D1DatabaseLike | null; source: EnvSource }> {
  if (captured && isD1(captured.DB)) return { db: captured.DB, source: "server-entry" };
  try {
    const modName = "cloudflare:workers";
    const mod = (await import(/* @vite-ignore */ modName)) as { env?: Record<string, unknown> };
    if (mod.env && isD1(mod.env.DB)) return { db: mod.env.DB, source: "cloudflare:workers" };
  } catch {
    // Not running on Workers (vite dev, tests) or module unavailable.
  }
  return { db: null, source: "none" };
}
