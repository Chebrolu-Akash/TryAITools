// Bulk tool management for the admin: select many tools (one page, or every tool matching the filters), preview the
// exact changes (dry run), apply them in small chunks, and undo a whole operation.
//
// Safety rules
// - Only the fields the editor chose are written; everything else is read back unchanged.
// - Every change is validated per tool (category/subcategory pairs, publishing rules, the indexing gate, tag vocabulary);
//   an invalid tool is skipped with its reason, the others still apply.
// - A chunk is at most CHUNK tools and one D1 batch (atomic): the tool UPDATEs, one audit row per tool and one undo row
//   per tool (its before/after values). Workers Free allows ~50 D1 queries per request, so chunks stay small and the
//   browser loops over them with a progress bar.
// - Undo restores a tool only while the fields still hold the values this operation wrote (nobody edited them since);
//   otherwise that tool is reported as a conflict and left alone.
import * as z from "zod";
import { TOOL_TAGS } from "@/lib/tags";
import {
  auditStep,
  catalogVersionStep,
  HttpError,
  readSafe,
  writeBatch,
  type AdminDb,
  type WriteStep,
} from "./db";
import { loadGateContexts } from "./gate-context";
import { gateDecision, gateFailures, type GateContext, type GateTool } from "./index-gate";
import { isSafeHttpUrl } from "./validation";
import { clampInt, need, parseJson, toolFilter, type Ctx, type Row } from "./repo";

export const CHUNK = 10;
export const MAX_SELECTION = 5000;

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const setSchema = z
  .object({
    category_id: z.string().min(1).max(80).optional(),
    subcategory: z.string().max(120).nullable().optional(),
    indexing: z.enum(["index", "noindex"]).optional(),
    status: z.enum(["draft", "review", "published", "archived"]).optional(),
    review_status: z.enum(["unreviewed", "draft_ready", "reviewed", "needs_manual"]).optional(),
    needs_review: z.union([z.literal(0), z.literal(1)]).optional(),
    pricing_model: z.enum(["free", "freemium", "free_trial", "paid"]).nullable().optional(),
  })
  .strict();
const tagsSchema = z
  .object({
    mode: z.enum(["add", "remove", "replace"]),
    values: z.array(z.enum(TOOL_TAGS as unknown as [string, ...string[]])).max(15),
  })
  .strict();
const membershipsSchema = z
  .object({
    add: z
      .array(
        z
          .object({
            category_id: z.string().min(1).max(80),
            subcategory: z.string().max(120).nullable(),
          })
          .strict(),
      )
      .max(15)
      .optional(),
    remove: z.array(z.string().min(1).max(80)).max(15).optional(),
  })
  .strict();
/** One edit: the same `set`/`tags`/`memberships` for every slug, or per-row values in `rows`. */
export const bulkEditSchema = z
  .object({
    slugs: z.array(slug).min(1).max(500),
    set: setSchema.optional(),
    tags: tagsSchema.optional(),
    memberships: membershipsSchema.optional(),
    rows: z
      .array(z.object({ slug, set: setSchema }).strict())
      .max(500)
      .optional(),
  })
  .strict()
  .refine((v) => v.set || v.tags || v.memberships || v.rows, "Choose at least one change");
export const bulkApplySchema = z
  .object({
    slugs: z.array(slug).min(1).max(CHUNK),
    set: setSchema.optional(),
    tags: tagsSchema.optional(),
    memberships: membershipsSchema.optional(),
    rows: z
      .array(z.object({ slug, set: setSchema }).strict())
      .max(CHUNK)
      .optional(),
  })
  .strict();
export const bulkStartSchema = z
  .object({
    action: z.string().min(1).max(60),
    summary: z.string().min(1).max(200),
    total: z.number().int().min(1).max(MAX_SELECTION),
  })
  .strict();
export const bulkUndoSchema = z
  .object({ limit: z.number().int().min(1).max(CHUNK).optional() })
  .strict();

type Edit = z.infer<typeof bulkEditSchema>;
type Membership = { category_id: string; subcategory: string | null };
/** The fields bulk editing may touch; `tags` and `memberships` are JSON. */
const FIELDS = [
  "category_id",
  "subcategory",
  "indexing",
  "status",
  "review_status",
  "needs_review",
  "pricing_model",
  "tags",
] as const;
type Field = (typeof FIELDS)[number];
type State = Record<Field, unknown> & { memberships: Membership[] };

// ------------------------------------------------------------------------------------------------ filters & selection
/** Every slug matching the filters (for "select all matching"), capped at MAX_SELECTION. */
export async function selectMatching(db: AdminDb | null, p: Record<string, string | undefined>) {
  const d = need(db);
  const { where, params } = toolFilter(p);
  return readSafe(async () => {
    const rows = await d
      .prepare(`SELECT t.slug FROM tools t ${where} ORDER BY t.sort_order, t.id LIMIT ?`)
      .bind(...params, MAX_SELECTION + 1)
      .all<{ slug: string }>();
    const slugs = rows.results.map((r) => r.slug);
    return { slugs: slugs.slice(0, MAX_SELECTION), capped: slugs.length > MAX_SELECTION };
  });
}

// ------------------------------------------------------------------------------------------------ planning
type Category = { id: string; status: string; subs: string[] };
type ToolRow = Row & { id: string; slug: string; name: string };

async function loadContext(d: AdminDb, slugs: string[]) {
  const [tools, cats, mems] = await Promise.all([
    d
      .prepare(
        `SELECT t.*, c.status AS category_status FROM tools t JOIN categories c ON c.id = t.category_id
          WHERE t.slug IN (SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(slugs))
      .all<ToolRow>(),
    d.prepare("SELECT id, status, subcategories FROM categories").all<Row>(),
    d
      .prepare(
        `SELECT m.tool_id, m.category_id, m.subcategory FROM tool_categories m
          WHERE m.tool_id IN (SELECT id FROM tools WHERE slug IN (SELECT value FROM json_each(?)))`,
      )
      .bind(JSON.stringify(slugs))
      .all<Row>(),
  ]);
  const categories = new Map<string, Category>(
    cats.results.map((c) => [
      String(c["id"]),
      {
        id: String(c["id"]),
        status: String(c["status"]),
        subs: (parseJson(c["subcategories"]) as string[]) ?? [],
      },
    ]),
  );
  const memberships = new Map<string, Membership[]>();
  for (const m of mems.results) {
    const k = String(m["tool_id"]);
    memberships.set(k, [
      ...(memberships.get(k) ?? []),
      {
        category_id: String(m["category_id"]),
        subcategory: (m["subcategory"] as string | null) ?? null,
      },
    ]);
  }
  return { tools: new Map(tools.results.map((t) => [t.slug, t])), categories, memberships };
}

const stateOf = (t: ToolRow, mems: Membership[]): State => ({
  category_id: t["category_id"],
  subcategory: t["subcategory"] ?? null,
  indexing: t["indexing"],
  status: t["status"],
  review_status: t["review_status"] ?? "unreviewed",
  needs_review: Number(t["needs_review"]),
  pricing_model: t["pricing_model"] ?? null,
  tags: (parseJson(t["tags"]) as string[] | null) ?? [],
  memberships: [...mems].sort((a, b) => a.category_id.localeCompare(b.category_id)),
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type PlanItem = {
  slug: string;
  name: string;
  status: "change" | "unchanged" | "invalid" | "missing";
  changes: Record<string, { from: unknown; to: unknown }>;
  /** The tool's current values (for the per-row editor). */
  current?: State;
  reasons: string[];
};

/** Applies the edit to one tool's current state and validates the result. Pure. */
export function planTool(
  t: ToolRow,
  mems: Membership[],
  edit: { set?: Edit["set"]; tags?: Edit["tags"]; memberships?: Edit["memberships"] },
  categories: Map<string, Category>,
  gate: GateContext,
): { item: PlanItem; before: State; after: State } {
  const before = stateOf(t, mems);
  const after: State = {
    ...before,
    tags: [...(before.tags as string[])],
    memberships: [...before.memberships],
  };
  const reasons: string[] = [];
  const s = edit.set ?? {};
  for (const k of Object.keys(s) as (keyof typeof s)[])
    (after as Record<string, unknown>)[k] = s[k] ?? null;

  // category / subcategory
  const cat = categories.get(String(after.category_id));
  if (!cat) reasons.push(`unknown category ${String(after.category_id)}`);
  else {
    if (cat.status === "archived") reasons.push("category is archived");
    if (after.subcategory !== null && !cat.subs.includes(String(after.subcategory)))
      reasons.push(
        s.category_id && s.subcategory === undefined
          ? `choose a subcategory of the new category (current "${String(after.subcategory)}" is not in it)`
          : `subcategory "${String(after.subcategory)}" is not in this category`,
      );
  }
  // status rules (mirror the single-tool actions)
  if (s.status && s.status !== before.status) {
    if (s.status === "published") {
      if (Number(after.needs_review) === 1)
        reasons.push("flagged as needing review: clear the flag before publishing");
      if (typeof t["url"] !== "string" || !isSafeHttpUrl(String(t["url"])))
        reasons.push("no valid official URL to publish");
    }
    if (s.status !== "published") after.indexing = "noindex";
  }
  if (Number(after.needs_review) === 1 && after.status === "published" && s.needs_review === 1) {
    after.status = "draft"; // flagging a published tool takes it offline, like the single action
    after.indexing = "noindex";
  }
  // tags
  if (edit.tags) {
    const cur = new Set(after.tags as string[]);
    if (edit.tags.mode === "replace") after.tags = [...new Set(edit.tags.values)];
    else if (edit.tags.mode === "add")
      after.tags = [...cur, ...edit.tags.values.filter((v) => !cur.has(v))];
    else after.tags = [...cur].filter((v) => !edit.tags!.values.includes(v));
    if ((after.tags as string[]).length > 15) reasons.push("at most 15 tags");
  }
  // memberships
  if (edit.memberships) {
    let m = after.memberships.filter(
      (x) => !(edit.memberships!.remove ?? []).includes(x.category_id),
    );
    for (const a of edit.memberships.add ?? []) {
      const c = categories.get(a.category_id);
      if (!c) reasons.push(`unknown category ${a.category_id}`);
      else if (a.subcategory !== null && !c.subs.includes(a.subcategory))
        reasons.push(`subcategory "${a.subcategory}" is not in ${a.category_id}`);
      m = m.filter((x) => x.category_id !== a.category_id);
      if (a.category_id !== after.category_id) m.push(a);
    }
    after.memberships = m.sort((a, b) => a.category_id.localeCompare(b.category_id));
  }
  // a primary category is never also a membership
  after.memberships = after.memberships.filter((x) => x.category_id !== after.category_id);
  // "reviewed" comes only from an editor's approval of a draft (G9), never from a bulk edit
  if (s.review_status === "reviewed" && before.review_status !== "reviewed" && !gate.approval)
    reasons.push(
      "G9: only an approved review can mark a tool reviewed (approve its draft in the editor)",
    );
  // the indexing gate (G1–G10) whenever the result is, or stays, indexed: newly indexed tools must pass every check,
  // indexed tools may not be changed into failing a check they passed. No override.
  if (after.indexing === "index") {
    const wasIndexed = before.indexing === "index";
    const curCat = categories.get(String(t["category_id"]));
    const failsAfter = gateFailures(
      { ...t, ...after, category_status: cat?.status ?? null } as unknown as GateTool,
      gate,
    );
    const failsBefore = wasIndexed
      ? gateFailures({ ...t, category_status: curCat?.status ?? null } as unknown as GateTool, gate)
      : [];
    reasons.push(...gateDecision(wasIndexed, failsBefore, failsAfter));
  }
  const changes: PlanItem["changes"] = {};
  for (const k of [...FIELDS, "memberships"] as const)
    if (!same((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k]))
      changes[k] = {
        from: (before as Record<string, unknown>)[k],
        to: (after as Record<string, unknown>)[k],
      };
  const status = reasons.length ? "invalid" : Object.keys(changes).length ? "change" : "unchanged";
  return {
    item: { slug: t.slug, name: String(t.name), status, changes, reasons, current: before },
    before,
    after,
  };
}

function editFor(edit: Pick<Edit, "set" | "tags" | "memberships" | "rows">, slugV: string) {
  const row = edit.rows?.find((r) => r.slug === slugV);
  return {
    set: { ...(edit.set ?? {}), ...(row?.set ?? {}) },
    tags: edit.tags,
    memberships: edit.memberships,
  };
}

/** Dry run: what would change for each selected tool, and why some would be skipped. Writes nothing. */
export async function previewBulk(db: AdminDb | null, edit: Edit) {
  const d = need(db);
  return readSafe(async () => {
    const items: PlanItem[] = [];
    // reads in slices so a 500-tool preview stays within the per-request query budget
    for (let i = 0; i < edit.slugs.length; i += 250) {
      const part = edit.slugs.slice(i, i + 250);
      const ctx = await loadContext(d, part);
      const gates = await loadGateContexts(d, [...ctx.tools.values()], new Date().toISOString());
      for (const s of part) {
        const t = ctx.tools.get(s);
        if (!t) {
          items.push({
            slug: s,
            name: s,
            status: "missing",
            changes: {},
            reasons: ["tool not found"],
          });
          continue;
        }
        items.push(
          planTool(
            t,
            ctx.memberships.get(t.id) ?? [],
            editFor(edit, s),
            ctx.categories,
            gates.get(s)!,
          ).item,
        );
      }
    }
    const count = (k: PlanItem["status"]) => items.filter((x) => x.status === k).length;
    return {
      items,
      counts: {
        selected: items.length,
        change: count("change"),
        unchanged: count("unchanged"),
        invalid: count("invalid"),
        missing: count("missing"),
      },
    };
  });
}

// ------------------------------------------------------------------------------------------------ operations
export async function startOperation(ctx: Ctx, input: z.infer<typeof bulkStartSchema>) {
  const d = need(ctx.db);
  const id = crypto.randomUUID();
  await writeBatch(d, [
    {
      sql: "INSERT INTO bulk_operations (id, actor_email, action, summary, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [id, ctx.actor, input.action, input.summary, input.total, ctx.now, ctx.now],
      expectChanges: 1,
    },
  ]);
  return { op: { id } };
}

async function getOp(d: AdminDb, id: string) {
  const op = await readSafe(() =>
    d.prepare("SELECT * FROM bulk_operations WHERE id = ?").bind(id).first<Row>(),
  );
  if (!op) throw new HttpError(404, "not_found", "Bulk operation not found.");
  return op;
}

const COLUMN: Record<Exclude<Field, "tags">, string> = {
  category_id: "category_id",
  subcategory: "subcategory",
  indexing: "indexing",
  status: "status",
  review_status: "review_status",
  needs_review: "needs_review",
  pricing_model: "pricing_model",
};

/** The statements that move one tool from `before` to `after` (only changed fields), stamped with `now`. */
function toolSteps(
  toolId: string,
  before: State,
  after: State,
  now: string,
  expectUpdatedAt: string,
): WriteStep[] {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of Object.keys(COLUMN) as (keyof typeof COLUMN)[])
    if (!same(before[k], after[k])) {
      sets.push(`${COLUMN[k]} = ?`);
      params.push(after[k]);
    }
  if (!same(before.tags, after.tags)) {
    sets.push("tags = ?");
    params.push(JSON.stringify(after.tags));
  }
  if (after.review_status === "reviewed" && before.review_status !== "reviewed") {
    sets.push("reviewed_at = ?");
    params.push(now);
  }
  sets.push("updated_at = ?");
  params.push(now);
  const steps: WriteStep[] = [
    {
      sql: `UPDATE tools SET ${sets.join(", ")} WHERE id = ? AND updated_at = ?`,
      params: [...params, toolId, expectUpdatedAt],
      expectChanges: 1,
    },
  ];
  if (!same(before.memberships, after.memberships)) {
    steps.push({
      sql: "DELETE FROM tool_categories WHERE tool_id = ?",
      params: [toolId],
      expectChanges: before.memberships.length,
    });
    for (const [i, m] of after.memberships.entries())
      steps.push({
        sql: "INSERT INTO tool_categories (tool_id, category_id, subcategory, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
        params: [toolId, m.category_id, m.subcategory, i, now],
        expectChanges: 1,
      });
  }
  return steps;
}

const summarize = (changes: PlanItem["changes"]) =>
  Object.entries(changes)
    .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
    .join("; ");

/** Applies one chunk (≤ CHUNK tools) of an operation. Each tool is its own atomic batch, so one failure never blocks the rest. */
export async function applyChunk(ctx: Ctx, opId: string, input: z.infer<typeof bulkApplySchema>) {
  const d = need(ctx.db);
  const op = await getOp(d, opId);
  if (op["status"] !== "running")
    throw new HttpError(409, "operation_closed", "This bulk operation is finished.");
  const c = await readSafe(() => loadContext(d, input.slugs));
  const gates = await readSafe(() => loadGateContexts(d, [...c.tools.values()], ctx.now));
  const results: {
    slug: string;
    result: "applied" | "unchanged" | "skipped" | "failed";
    reasons?: string[];
  }[] = [];
  const toWrite: { t: ToolRow; plan: ReturnType<typeof planTool> }[] = [];
  for (const s of input.slugs) {
    const t = c.tools.get(s);
    if (!t) {
      results.push({ slug: s, result: "skipped", reasons: ["tool not found"] });
      continue;
    }
    const plan = planTool(
      t,
      c.memberships.get(t.id) ?? [],
      editFor(input, s),
      c.categories,
      gates.get(s)!,
    );
    if (plan.item.status === "invalid")
      results.push({ slug: s, result: "skipped", reasons: plan.item.reasons });
    else if (plan.item.status === "unchanged") results.push({ slug: s, result: "unchanged" });
    else toWrite.push({ t, plan });
  }
  // one batch for the whole chunk (fewest queries); if it fails, retry tool by tool to isolate the failure
  const stepsFor = ({ t, plan }: (typeof toWrite)[number]): WriteStep[] => [
    ...toolSteps(t.id, plan.before, plan.after, ctx.now, String(t["updated_at"])),
    auditStep(
      ctx.actor,
      "tool.bulk_update",
      "tool",
      t.slug,
      `Bulk ${String(op["action"])}: ${summarize(plan.item.changes)}`,
      ctx.now,
      {
        table: "tools",
        key: "id",
        value: t.id,
        stamp: "updated_at",
      },
    ),
    {
      sql: "INSERT INTO bulk_operation_items (op_id, tool_id, slug, before, after) VALUES (?, ?, ?, ?, ?)",
      params: [opId, t.id, t.slug, JSON.stringify(plan.before), JSON.stringify(plan.after)],
      expectChanges: 1,
    },
  ];
  const closing = (applied: number, skipped: number, failed: number): WriteStep[] => [
    catalogVersionStep(ctx.now),
    {
      sql: "UPDATE bulk_operations SET applied = applied + ?, skipped = skipped + ?, failed = failed + ?, updated_at = ? WHERE id = ?",
      params: [applied, skipped, failed, ctx.now, opId],
      expectChanges: 1,
    },
  ];
  const skipped = results.filter((r) => r.result === "skipped").length;
  if (toWrite.length) {
    try {
      await writeBatch(d, [...toWrite.flatMap(stepsFor), ...closing(toWrite.length, skipped, 0)]);
      for (const w of toWrite) results.push({ slug: w.t.slug, result: "applied" });
    } catch {
      let applied = 0;
      let failed = 0;
      for (const w of toWrite) {
        try {
          await writeBatch(d, stepsFor(w));
          applied++;
          results.push({ slug: w.t.slug, result: "applied" });
        } catch (e) {
          failed++;
          results.push({
            slug: w.t.slug,
            result: "failed",
            reasons: [e instanceof HttpError ? e.message : "write failed"],
          });
        }
      }
      await writeBatch(d, closing(applied, skipped, failed));
    }
  } else if (skipped) await writeBatch(d, closing(0, skipped, 0).slice(1));
  return { results };
}

export async function finishOperation(ctx: Ctx, opId: string) {
  const d = need(ctx.db);
  await getOp(d, opId);
  await writeBatch(d, [
    {
      sql: "UPDATE bulk_operations SET status = 'done', updated_at = ? WHERE id = ? AND status = 'running'",
      params: [ctx.now, opId],
      expectChanges: 1,
    },
  ]);
  return { op: await getOp(d, opId) };
}

export async function listOperations(db: AdminDb | null, p: Record<string, string | undefined>) {
  const d = need(db);
  const limit = clampInt(p["limit"], 1, 50, 20);
  return readSafe(async () => ({
    items: (
      await d
        .prepare(
          `SELECT o.*, (SELECT count(*) FROM bulk_operation_items i WHERE i.op_id = o.id AND i.undone_at IS NULL) AS undoable
             FROM bulk_operations o ORDER BY o.created_at DESC LIMIT ?`,
        )
        .bind(limit)
        .all<Row>()
    ).results,
  }));
}

/**
 * Undoes up to `limit` tools of an operation. A tool is restored only if every field this operation changed still
 * holds the value it wrote; otherwise it is reported as a conflict (someone edited it since) and left alone.
 */
export async function undoChunk(ctx: Ctx, opId: string, input: z.infer<typeof bulkUndoSchema>) {
  const d = need(ctx.db);
  const op = await getOp(d, opId);
  if (op["status"] === "running")
    throw new HttpError(409, "operation_running", "Finish the operation before undoing it.");
  const items = await readSafe(() =>
    d
      .prepare("SELECT * FROM bulk_operation_items WHERE op_id = ? AND undone_at IS NULL LIMIT ?")
      .bind(opId, input.limit ?? CHUNK)
      .all<Row>(),
  );
  const slugs = items.results.map((i) => String(i["slug"]));
  const c = slugs.length ? await readSafe(() => loadContext(d, slugs)) : null;
  const gates = c
    ? await readSafe(() => loadGateContexts(d, [...c.tools.values()], ctx.now))
    : null;
  const results: {
    slug: string;
    result: "restored" | "conflict" | "missing" | "blocked";
    reasons?: string[];
  }[] = [];
  const steps: WriteStep[] = [];
  const done: Row[] = [];
  for (const it of items.results) {
    const t = c?.tools.get(String(it["slug"]));
    const before = parseJson(it["before"]) as State;
    const after = parseJson(it["after"]) as State;
    if (!t) {
      results.push({ slug: String(it["slug"]), result: "missing" });
      done.push(it);
      continue;
    }
    const now = stateOf(t, c!.memberships.get(t.id) ?? []);
    const touched = ([...FIELDS, "memberships"] as const).filter((k) => !same(before[k], after[k]));
    if (touched.some((k) => !same(now[k], after[k]))) {
      results.push({ slug: t.slug, result: "conflict" });
      done.push(it);
      continue;
    }
    const restored = { ...now, ...Object.fromEntries(touched.map((k) => [k, before[k]])) } as State;
    // Undo may switch indexing back on only through the gate (G1–G10), like any other path. No override.
    if (restored.indexing === "index" && now.indexing !== "index") {
      const cat = c!.categories.get(String(restored.category_id));
      const reasons = gateFailures(
        { ...t, ...restored, category_status: cat?.status ?? null } as unknown as GateTool,
        gates!.get(t.slug)!,
      ).map((x) => x.reason);
      if (reasons.length) {
        results.push({ slug: t.slug, result: "blocked", reasons });
        done.push(it); // left as it is, like a conflict; it can be indexed later through the gate
        continue;
      }
    }
    steps.push(
      ...toolSteps(t.id, now, restored, ctx.now, String(t["updated_at"])),
      auditStep(
        ctx.actor,
        "tool.bulk_undo",
        "tool",
        t.slug,
        `Undid bulk ${String(op["action"])}`,
        ctx.now,
        { table: "tools", key: "id", value: t.id, stamp: "updated_at" },
      ),
    );
    results.push({ slug: t.slug, result: "restored" });
    done.push(it);
  }
  const remaining =
    ((
      await readSafe(() =>
        d
          .prepare(
            "SELECT count(*) AS n FROM bulk_operation_items WHERE op_id = ? AND undone_at IS NULL",
          )
          .bind(opId)
          .first<{ n: number }>(),
      )
    )?.n ?? 0) - done.length;
  steps.push(
    ...done.map((it) => ({
      sql: "UPDATE bulk_operation_items SET undone_at = ? WHERE op_id = ? AND tool_id = ?",
      params: [ctx.now, opId, it["tool_id"]],
      expectChanges: 1,
    })),
    {
      sql: "UPDATE bulk_operations SET status = ?, updated_at = ? WHERE id = ?",
      params: [remaining > 0 ? "partially_undone" : "undone", ctx.now, opId],
      expectChanges: 1,
    },
  );
  if (results.some((r) => r.result === "restored")) steps.push(catalogVersionStep(ctx.now));
  if (done.length) await writeBatch(d, steps);
  return { results, remaining };
}
