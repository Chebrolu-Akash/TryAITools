// Single-tool indexing (approved workflow): the gate status shown in the editor, and the only per-tool action that
// switches indexing on. Every check of G1–G10 runs here on the server; there is no override. Switching indexing off is
// always allowed.
import * as z from "zod";
import { auditStep, catalogVersionStep, HttpError, readSafe, writeBatch, type AdminDb } from "./db";
import { loadGateContexts } from "./gate-context";
import { gateDecision, gateFailures, type GateTool } from "./index-gate";
import { need, type Ctx, type Row } from "./repo";

export const indexingSchema = z
  .object({ indexing: z.enum(["index", "noindex"]), updated_at: z.string().min(10).max(40) })
  .strict();

const row = async (d: AdminDb, slug: string) => {
  const r = await readSafe(() =>
    d
      .prepare(
        "SELECT t.*, c.status AS category_status FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = ?",
      )
      .bind(slug)
      .first<Row>(),
  );
  if (!r) throw new HttpError(404, "not_found", "Tool not found.");
  return r;
};

/**
 * The reasons a tool (as it would be after `next`) may not be indexed, applying the no-regression rule to tools that
 * are already indexed. Used by the editor's save and the indexing action. `next` holds the edited fields, if any.
 */
export async function gateReasons(
  d: AdminDb,
  current: Row,
  next: Row,
  now: string,
): Promise<string[]> {
  const ctxs = await readSafe(() => loadGateContexts(d, [{ ...current, ...next }], now));
  const c = ctxs.get(String(current["slug"]))!;
  const wasIndexed = current["indexing"] === "index";
  const after = gateFailures({ ...current, ...next } as unknown as GateTool, c);
  const before = wasIndexed ? gateFailures(current as unknown as GateTool, c) : [];
  return gateDecision(wasIndexed, before, after);
}

/** G1–G10 as they stand now, for the editor's indexing panel. */
export async function toolGate(db: AdminDb | null, slug: string, now: string) {
  const d = need(db);
  const t = await row(d, slug);
  const ctxs = await readSafe(() => loadGateContexts(d, [t], now));
  const failures = gateFailures(t as unknown as GateTool, ctxs.get(slug)!);
  return {
    indexing: t["indexing"],
    passes: failures.length === 0,
    failures,
    checks: ["base", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10"].map((id) => ({
      id,
      ok: !failures.some((f) => f.id === id),
      reasons: failures.filter((f) => f.id === id).map((f) => f.reason),
    })),
  };
}

/** Switches indexing on (only when every check passes) or off (always allowed). */
export async function setToolIndexing(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof indexingSchema>,
) {
  const d = need(ctx.db);
  const t = await row(d, slug);
  if (t["indexing"] === input.indexing) return { ok: true, unchanged: true };
  if (input.indexing === "index") {
    const reasons = await gateReasons(d, t, { indexing: "index" }, ctx.now);
    if (reasons.length)
      throw new HttpError(422, "index_gate", `This tool cannot be indexed: ${reasons.join("; ")}`, {
        indexing: reasons.join("; "),
      });
  }
  await writeBatch(d, [
    {
      sql: "UPDATE tools SET indexing = ?, updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [input.indexing, ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      input.indexing === "index" ? "tool.index_enable" : "tool.index_disable",
      "tool",
      slug,
      input.indexing === "index" ? "Indexing enabled (passed G1–G10)" : "Indexing disabled",
      ctx.now,
      { table: "tools", key: "slug", value: slug, stamp: "updated_at" },
    ),
    catalogVersionStep(ctx.now),
  ]);
  return { ok: true, unchanged: false };
}
