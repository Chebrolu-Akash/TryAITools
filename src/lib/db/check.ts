import { getD1 } from "./env";
import type { D1DatabaseLike } from "./types";

// TEMPORARY Stage-2 diagnostic. Replaced by an Access-protected admin health page in Stage 3.
// It answers only on preview/local hosts and 404s everywhere else, including tryaitools.io.
const ALLOWED_HOST = /(^|\.)workers\.dev$|^localhost$|^127\.0\.0\.1$/;

export async function handleDbCheck(request: Request, resolve: () => Promise<{ db: D1DatabaseLike | null; source: string }> = getD1): Promise<Response> {
  const headers = { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" };
  const host = new URL(request.url).hostname;
  if (!ALLOWED_HOST.test(host)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

  const { db, source } = await resolve();
  const body: Record<string, unknown> = { bound: !!db, bindingSource: source, environment: null, canRead: false, tools: null, categories: null };
  if (db) {
    try {
      const env = await db.prepare("SELECT value FROM meta WHERE key = 'environment'").first<{ value: string }>();
      const t = await db.prepare("SELECT count(*) AS c FROM tools").first<{ c: number }>();
      const c = await db.prepare("SELECT count(*) AS c FROM categories").first<{ c: number }>();
      Object.assign(body, { environment: env?.value ?? null, canRead: true, tools: t?.c ?? null, categories: c?.c ?? null });
    } catch (e) {
      console.error("db-check query failed", e);
      body.error = "query_failed";
    }
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}
