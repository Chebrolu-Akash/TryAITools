import type { D1DatabaseLike } from "./types";

export type EnvSource = "server-entry" | "cloudflare:workers" | "none";
let captured: Record<string, unknown> | null = null;

/** Called from src/server.ts with the Worker `env` argument, when the runtime passes one. */
export function captureRuntimeEnv(env: unknown) {
  if (env && typeof env === "object") captured = env as Record<string, unknown>;
}

const isD1 = (v: unknown): v is D1DatabaseLike =>
  !!v && typeof (v as D1DatabaseLike).prepare === "function";

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

const ADMIN_KEYS = ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "OWNER_EMAILS"] as const;
const hasAdminKeys = (e: unknown): e is Record<string, unknown> =>
  !!e && typeof e === "object" && ADMIN_KEYS.some((k) => k in (e as object));

const loadWorkersEnv = async (): Promise<Record<string, unknown> | null> => {
  try {
    const modName = "cloudflare:workers";
    const mod = (await import(/* @vite-ignore */ modName)) as { env?: Record<string, unknown> };
    return mod.env ?? null;
  } catch {
    return null; // not running on Workers (vite dev, tests)
  }
};

/**
 * The Worker `env` (vars, secrets and bindings) or an empty object when unavailable. Used by the admin to
 * read Cloudflare Access settings. The env handed to src/server.ts is only trusted if it actually carries
 * those settings: if the runtime passes something else as the second argument, we fall through to the
 * `cloudflare:workers` env instead of failing closed forever. Never throws; missing configuration makes the
 * admin answer 503. (`loader` is injectable for tests.)
 */
export async function getRuntimeEnv(
  loader: () => Promise<Record<string, unknown> | null> = loadWorkersEnv,
): Promise<Record<string, unknown>> {
  if (hasAdminKeys(captured)) return captured;
  const fromWorkers = await loader();
  if (hasAdminKeys(fromWorkers)) return fromWorkers;
  return {};
}
