import * as z from "zod";
import {
  auditStep,
  catalogVersionStep,
  contentVersionStep,
  HttpError,
  readSafe,
  writeBatch,
  type AdminDb,
} from "./db";
import {
  isSafeHttpUrl,
  type blogActionSchema,
  type blogCreateSchema,
  type blogUpdateSchema,
  type categoryCreateSchema,
  type categoryUpdateSchema,
  type deleteSchema,
  type toolActionSchema,
  type toolCreateSchema,
  type toolUpdateSchema,
} from "./validation";

// All SQL here is parameterized: user input only ever reaches D1 as a bound value. Column lists and
// ORDER BY clauses are fixed in code, never built from request data.

export type Row = Record<string, unknown>;
export type Ctx = { db: AdminDb | null; actor: string; now: string };

export const need = (db: AdminDb | null): AdminDb => {
  if (!db) throw new HttpError(503, "database_unavailable", "The database is not available.");
  return db;
};
export const parseJson = (v: unknown): unknown => {
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

export type DeleteInput = z.infer<typeof deleteSchema>;
export const checkConfirm = (slug: string, input: DeleteInput) => {
  if (input.confirm !== slug)
    throw new HttpError(422, "confirm_mismatch", "Type the slug exactly to confirm deletion.", {
      confirm: "Does not match the slug",
    });
};

/**
 * A permanent delete as one atomic batch: the audit row first, inserted only if the row still matches `guardSql`
 * (same slug, same updated_at, still deletable), then the DELETE with the same guard. A stale or no-longer-deletable
 * row makes the first statement change nothing, which writeBatch() reports as a 409 conflict; nothing is deleted.
 * `table` and `guardSql` are fixed strings from this file, never request data.
 */
export async function deleteGuarded(
  ctx: Ctx,
  d: AdminDb,
  table:
    "tools" | "categories" | "blog_posts" | "courses" | "gadgets" | "guest_articles" | "tutorials",
  guardSql: string,
  entity: { type: string; action: string; slug: string; summary: string },
  updatedAt: string,
) {
  await writeBatch(d, [
    {
      sql: `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${table} WHERE slug = ? AND updated_at = ? AND ${guardSql})`,
      params: [
        ctx.now,
        ctx.actor,
        entity.action,
        entity.type,
        entity.slug,
        entity.summary.slice(0, 200),
        entity.slug,
        updatedAt,
      ],
      expectChanges: 1,
    },
    {
      sql: `DELETE FROM ${table} WHERE slug = ? AND updated_at = ? AND ${guardSql}`,
      params: [entity.slug, updatedAt],
      expectChanges: 1,
    },
    table === "tools" || table === "categories"
      ? catalogVersionStep(ctx.now)
      : contentVersionStep(ctx.now),
  ]);
  return { deleted: true, slug: entity.slug };
}

// ---------------------------------------------------------------- stats

export async function getStats(db: AdminDb | null) {
  const d = need(db);
  return readSafe(async () => {
    const t = (await d
      .prepare(
        `SELECT count(*) AS total,
                COALESCE(sum(status='published'),0) AS published, COALESCE(sum(status='draft'),0) AS draft,
                COALESCE(sum(status='review'),0) AS review, COALESCE(sum(status='archived'),0) AS archived,
                COALESCE(sum(needs_review=1),0) AS needs_review, COALESCE(sum(indexing='index'),0) AS indexable
         FROM tools`,
      )
      .first<Row>()) as Row;
    const c = (await d.prepare("SELECT count(*) AS total FROM categories").first<Row>()) as Row;
    let blog: Row | { available: false } = { available: false };
    try {
      const b = (await d
        .prepare(
          "SELECT count(*) AS total, COALESCE(sum(status='published'),0) AS published, COALESCE(sum(status='draft'),0) AS draft, COALESCE(sum(status='archived'),0) AS archived FROM blog_posts",
        )
        .first<Row>()) as Row;
      blog = { available: true, ...b };
    } catch {
      // blog_posts missing: migration 0002 has not been applied to this database.
    }
    const recent = await d
      .prepare(
        "SELECT at, actor_email, action, entity_type, entity_id, summary FROM audit_events ORDER BY id DESC LIMIT 10",
      )
      .all<Row>();
    return { tools: t, categories: c, blog, recent: recent.results };
  });
}

// ---------------------------------------------------------------- tools

const TOOL_LIST_COLS =
  "t.id, t.slug, t.name, t.url, t.category_id, c.name AS category_name, t.subcategory, t.status, t.indexing, t.needs_review, t.import_issue, t.content_source, t.review_status, t.url_status, t.updated_at";

/** The WHERE clause of the tools list, shared by the paginated list and "select every matching tool". */
export function toolFilter(p: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = (p["q"] ?? "").trim().slice(0, 100);
  if (q) {
    where.push(
      "(t.name LIKE ? ESCAPE '\\' OR t.slug LIKE ? ESCAPE '\\' OR t.url LIKE ? ESCAPE '\\')",
    );
    const pat = likePattern(q);
    params.push(pat, pat, pat);
  }
  if (p["status"] && ["draft", "review", "published", "archived"].includes(p["status"])) {
    where.push("t.status = ?");
    params.push(p["status"]);
  }
  if (p["indexing"] && ["index", "noindex"].includes(p["indexing"])) {
    where.push("t.indexing = ?");
    params.push(p["indexing"]);
  }
  if (p["review"] === "1") where.push("t.needs_review = 1");
  if (
    p["review_status"] &&
    ["unreviewed", "draft_ready", "reviewed", "needs_manual"].includes(p["review_status"])
  ) {
    where.push("t.review_status = ?");
    params.push(p["review_status"]);
  }
  if (p["category"] && p["category"].length <= 80) {
    // the primary category, or an additional category membership
    where.push(
      "(t.category_id = ? OR t.id IN (SELECT tool_id FROM tool_categories WHERE category_id = ?))",
    );
    params.push(p["category"], p["category"]);
  }
  if (p["subcategory"] && p["subcategory"].length <= 120) {
    where.push("t.subcategory = ?");
    params.push(p["subcategory"]);
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function listTools(db: AdminDb | null, p: Record<string, string | undefined>) {
  const d = need(db);
  const { where: w, params } = toolFilter(p);
  const pageSize = clampInt(p["pageSize"], 1, 100, 25);
  const page = clampInt(p["page"], 1, 100000, 1);
  return readSafe(async () => {
    // Only the page's rows are joined to their category (joining before the LIMIT looked up a category for every tool).
    const [count, rows] = await Promise.all([
      d
        .prepare(`SELECT count(*) AS n FROM tools t ${w}`)
        .bind(...params)
        .first<{ n: number }>(),
      d
        .prepare(
          `SELECT ${TOOL_LIST_COLS} FROM (
             SELECT * FROM tools t ${w} ORDER BY t.sort_order, t.id LIMIT ? OFFSET ?
           ) t JOIN categories c ON c.id = t.category_id ORDER BY t.sort_order, t.id`,
        )
        .bind(...params, pageSize, (page - 1) * pageSize)
        .all<Row>(),
    ]);
    return { items: rows.results, total: count?.n ?? 0, page, pageSize };
  });
}

const TOOL_JSON_COLS = [
  "tags",
  "features",
  "pros",
  "limits",
  "steps",
  "tips",
  "platforms",
  "pricing_plans",
] as const;
function shapeTool(r: Row): Row {
  const out: Row = { ...r };
  for (const k of TOOL_JSON_COLS) out[k] = parseJson(r[k]);
  return out;
}

export async function getTool(db: AdminDb | null, slug: string) {
  const d = need(db);
  const row = await readSafe(() =>
    d
      .prepare(
        "SELECT t.*, c.name AS category_name FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = ?",
      )
      .bind(slug)
      .first<Row>(),
  );
  if (!row) throw new HttpError(404, "not_found", "Tool not found.");
  return shapeTool(row);
}

const TOOL_EDIT_COLS = [
  "name",
  "display_name",
  "url",
  "category_id",
  "subcategory",
  "tags",
  "logo_url",
  "tagline",
  "overview",
  "best_for",
  "features",
  "pros",
  "limits",
  "steps",
  "tips",
  "pricing_note",
  "pricing_source",
  "pricing_model",
  "pricing_plans",
  "pricing_checked_at",
  "platforms",
  "seo_title",
  "seo_description",
  "canonical_url",
  "og_image_url",
  "indexing",
] as const;
/** The page copy that content_source = 'admin' switches on (the tool page then uses these stored values). */
const COPY_COLS = new Set<string>([
  "tagline",
  "overview",
  "best_for",
  "features",
  "pros",
  "limits",
  "steps",
  "tips",
]);
const jsonOrNull = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const toolValues = (i: Row): unknown[] =>
  TOOL_EDIT_COLS.map((k) =>
    k === "tags"
      ? JSON.stringify(i.tags ?? [])
      : (TOOL_JSON_COLS as readonly string[]).includes(k)
        ? jsonOrNull(i[k])
        : (i[k] ?? null),
  );

async function checkCategory(
  d: AdminDb,
  categoryId: string,
  subcategory: string | null,
  existing?: Row,
) {
  const cat = await readSafe(() =>
    d
      .prepare("SELECT id, status, subcategories FROM categories WHERE id = ?")
      .bind(categoryId)
      .first<Row>(),
  );
  if (!cat)
    throw new HttpError(422, "invalid_category", "Choose an existing category.", {
      category_id: "Unknown category",
    });
  const unchangedCategory = existing && existing.category_id === categoryId;
  if (cat.status === "archived" && !unchangedCategory)
    throw new HttpError(422, "invalid_category", "That category is archived.", {
      category_id: "Category is archived",
    });
  if (subcategory) {
    const subs = (parseJson(cat.subcategories) as string[] | null) ?? [];
    const unchanged = unchangedCategory && existing?.subcategory === subcategory;
    if (!subs.includes(subcategory) && !unchanged)
      throw new HttpError(
        422,
        "invalid_subcategory",
        "Choose a subcategory that belongs to this category.",
        { subcategory: "Not a subcategory of the selected category" },
      );
  }
}

function checkIndexing(status: unknown, indexing: unknown) {
  if (indexing === "index" && status !== "published")
    throw new HttpError(422, "invalid_indexing", "Only published tools can be set to index.", {
      indexing: "Publish the tool before allowing indexing",
    });
}

export async function createTool(ctx: Ctx, input: z.infer<typeof toolCreateSchema>) {
  const d = need(ctx.db);
  const id = `adm-${input.client_id.toLowerCase()}`;
  const byId = await readSafe(() =>
    d.prepare("SELECT slug, name FROM tools WHERE id = ?").bind(id).first<Row>(),
  );
  if (byId) {
    // Retry of a request that already succeeded: return the stored record, create nothing.
    if (byId.slug === input.slug) return { tool: await getTool(d, input.slug), created: false };
    throw new HttpError(
      409,
      "duplicate",
      "This form was already submitted with a different slug. Reload the page.",
    );
  }
  const slugTaken = await readSafe(() =>
    d.prepare("SELECT 1 AS x FROM tools WHERE slug = ?").bind(input.slug).first<Row>(),
  );
  if (slugTaken)
    throw new HttpError(409, "slug_taken", "That slug is already used by another tool.", {
      slug: "Slug already in use",
    });
  checkIndexing("draft", input.indexing);
  await checkCategory(d, input.category_id, input.subcategory ?? null);

  const cols = [
    "id",
    "slug",
    ...TOOL_EDIT_COLS,
    "status",
    "needs_review",
    "content_source",
    "sort_order",
    "created_at",
    "updated_at",
  ];
  const sql = `INSERT INTO tools (${cols.join(",")}) VALUES (?, ?, ${TOOL_EDIT_COLS.map(() => "?").join(",")}, 'draft', 0, 'admin', (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools), ?, ?)`;
  await writeBatch(d, [
    { sql, params: [id, input.slug, ...toolValues(input), ctx.now, ctx.now], expectChanges: 1 },
    auditStep(
      ctx.actor,
      "tool.create",
      "tool",
      input.slug,
      `Created draft tool "${input.name}"`,
      ctx.now,
      { table: "tools", key: "id", value: id, stamp: "created_at" },
    ),
    catalogVersionStep(ctx.now), // public site re-reads the catalogue
  ]);
  return { tool: await getTool(d, input.slug), created: true };
}

export async function updateTool(ctx: Ctx, slug: string, input: z.infer<typeof toolUpdateSchema>) {
  const d = need(ctx.db);
  const existing = await readSafe(() =>
    d.prepare("SELECT * FROM tools WHERE slug = ?").bind(slug).first<Row>(),
  );
  if (!existing) throw new HttpError(404, "not_found", "Tool not found.");
  checkIndexing(existing.status, input.indexing);
  await checkCategory(d, input.category_id, input.subcategory ?? null, existing);
  const values = toolValues(input);
  // A save counts as a content edit (content_source = 'admin', which makes the page use the stored best-for, steps and
  // tips) only when the page copy itself changed. Saving pricing, the website URL, SEO fields and so on leaves the page's
  // copy exactly as it was.
  const n = (v: unknown) => (v === undefined || v === "" ? null : v);
  const same = (a: unknown, b: unknown) =>
    n(a) === n(b) || (n(a) !== null && String(a) === String(b));
  const contentEdited = TOOL_EDIT_COLS.some(
    (c, i) => COPY_COLS.has(c) && !same(values[i], existing[c]),
  );
  const sets = [
    ...TOOL_EDIT_COLS.map((c) => `${c} = ?`),
    ...(contentEdited ? ["content_source = 'admin'"] : []),
    "updated_at = ?",
  ].join(", ");
  await writeBatch(d, [
    {
      sql: `UPDATE tools SET ${sets} WHERE slug = ? AND updated_at = ?`,
      params: [...values, ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(ctx.actor, "tool.update", "tool", slug, `Edited tool "${input.name}"`, ctx.now, {
      table: "tools",
      key: "slug",
      value: slug,
      stamp: "updated_at",
    }),
    catalogVersionStep(ctx.now), // public site re-reads the catalogue
  ]);
  return { tool: await getTool(d, slug) };
}

export async function applyToolAction(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof toolActionSchema>,
) {
  const d = need(ctx.db);
  const row = await readSafe(() =>
    d
      .prepare(
        "SELECT t.*, c.status AS category_status FROM tools t JOIN categories c ON c.id = t.category_id WHERE t.slug = ?",
      )
      .bind(slug)
      .first<Row>(),
  );
  if (!row) throw new HttpError(404, "not_found", "Tool not found.");
  let status = row.status as string;
  let indexing = row.indexing as string;
  let needsReview = Number(row.needs_review);
  const bad = (m: string) => new HttpError(409, "invalid_transition", m);

  switch (input.action) {
    case "publish":
      if (status !== "draft" && status !== "review")
        throw bad("Only drafts and tools in review can be published.");
      if (needsReview === 1)
        throw bad(
          "This tool is flagged as needing review. Clear the flag after checking it, then publish.",
        );
      if (typeof row.url !== "string" || !isSafeHttpUrl(row.url))
        throw new HttpError(
          422,
          "not_publishable",
          "A valid official website URL is required before publishing.",
          { url: "Required to publish" },
        );
      if (row.category_status === "archived")
        throw new HttpError(422, "not_publishable", "The tool's category is archived.");
      status = "published";
      break;
    case "unpublish":
      if (status !== "published") throw bad("Only published tools can be unpublished.");
      status = "draft";
      indexing = "noindex";
      break;
    case "send_to_review":
      if (status !== "draft") throw bad("Only drafts can be sent to review.");
      status = "review";
      break;
    case "archive":
      if (status === "archived") throw bad("Already archived.");
      status = "archived";
      indexing = "noindex";
      break;
    case "restore":
      if (status !== "archived") throw bad("Only archived tools can be restored.");
      status = "draft";
      break;
    case "flag_needs_review":
      if (needsReview === 1) throw bad("Already flagged.");
      needsReview = 1;
      if (status === "published") {
        status = "draft";
        indexing = "noindex";
      }
      break;
    case "clear_needs_review":
      if (needsReview === 0) throw bad("Not flagged.");
      needsReview = 0;
      break;
  }
  await writeBatch(d, [
    {
      sql: "UPDATE tools SET status = ?, indexing = ?, needs_review = ?, updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [status, indexing, needsReview, ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      `tool.${input.action}`,
      "tool",
      slug,
      `${input.action} "${row.name}"`,
      ctx.now,
      { table: "tools", key: "slug", value: slug, stamp: "updated_at" },
    ),
    catalogVersionStep(ctx.now), // public site re-reads the catalogue
  ]);
  return { tool: await getTool(d, slug) };
}

/** Only archived tools can be deleted, so a live page can never disappear in one click. */
export async function deleteTool(ctx: Ctx, slug: string, input: DeleteInput) {
  const d = need(ctx.db);
  checkConfirm(slug, input);
  const row = await readSafe(() =>
    d.prepare("SELECT name, status FROM tools WHERE slug = ?").bind(slug).first<Row>(),
  );
  if (!row) throw new HttpError(404, "not_found", "Tool not found.");
  if (row.status !== "archived")
    throw new HttpError(409, "not_archived", "Archive the tool before deleting it permanently.");
  return deleteGuarded(
    ctx,
    d,
    "tools",
    "status = 'archived'",
    { type: "tool", action: "tool.delete", slug, summary: `Deleted tool "${row.name}"` },
    input.updated_at,
  );
}

// ---------------------------------------------------------------- categories

export async function listCategories(db: AdminDb | null) {
  const d = need(db);
  return readSafe(async () => {
    // One pass over tools gives every count (it used to be three: two correlated counts per category plus this one).
    const [rows, used] = await Promise.all([
      d.prepare("SELECT c.* FROM categories c ORDER BY c.sort_order, c.name").all<Row>(),
      d
        .prepare(
          "SELECT category_id AS c, subcategory AS s, count(*) AS n, COALESCE(sum(status <> 'archived'), 0) AS active FROM tools GROUP BY category_id, subcategory",
        )
        .all<{ c: string; s: string | null; n: number; active: number }>(),
    ]);
    const counts = new Map<string, Record<string, number>>();
    const totals = new Map<string, { all: number; active: number }>();
    for (const u of used.results) {
      const t = totals.get(u.c) ?? { all: 0, active: 0 };
      totals.set(u.c, { all: t.all + Number(u.n), active: t.active + Number(u.active) });
      if (u.s !== null) counts.set(u.c, { ...counts.get(u.c), [u.s]: Number(u.n) });
    }
    return {
      items: rows.results.map((r) => ({
        ...r,
        tool_count: totals.get(r["id"] as string)?.all ?? 0,
        active_tool_count: totals.get(r["id"] as string)?.active ?? 0,
        subcategories: parseJson(r.subcategories) ?? [],
        faqs: parseJson(r.faqs) ?? null,
        subcategory_counts: counts.get(r.id as string) ?? {},
      })),
    };
  });
}

const catRow = async (d: AdminDb, slug: string) => {
  const r = await readSafe(() =>
    d.prepare("SELECT * FROM categories WHERE slug = ?").bind(slug).first<Row>(),
  );
  if (!r) throw new HttpError(404, "not_found", "Category not found.");
  return { ...r, subcategories: parseJson(r.subcategories) ?? [] } as Row;
};

export async function createCategory(ctx: Ctx, input: z.infer<typeof categoryCreateSchema>) {
  const d = need(ctx.db);
  const clash = await readSafe(() =>
    d
      .prepare("SELECT slug FROM categories WHERE slug = ? OR lower(name) = lower(?)")
      .bind(input.slug, input.name)
      .first<Row>(),
  );
  if (clash)
    throw new HttpError(409, "duplicate", "A category with that slug or name already exists.", {
      slug: "Slug or name already in use",
    });
  await writeBatch(d, [
    {
      sql: "INSERT INTO categories (id, slug, name, description, subcategories, sort_order, status, indexing, seo_title, seo_description, intro, faqs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        input.slug,
        input.slug,
        input.name,
        input.description,
        JSON.stringify(input.subcategories),
        input.sort_order,
        input.status,
        input.indexing,
        input.seo_title,
        input.seo_description,
        input.intro ?? null,
        input.faqs?.length ? JSON.stringify(input.faqs) : null,
        ctx.now,
        ctx.now,
      ],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      "category.create",
      "category",
      input.slug,
      `Created category "${input.name}"`,
      ctx.now,
      { table: "categories", key: "id", value: input.slug, stamp: "created_at" },
    ),
    catalogVersionStep(ctx.now), // public site re-reads the catalogue
  ]);
  return { category: await catRow(d, input.slug) };
}

export async function updateCategory(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof categoryUpdateSchema>,
) {
  const d = need(ctx.db);
  const existing = await catRow(d, slug);
  const dupName = await readSafe(() =>
    d
      .prepare("SELECT slug FROM categories WHERE lower(name) = lower(?) AND slug <> ?")
      .bind(input.name, slug)
      .first<Row>(),
  );
  if (dupName)
    throw new HttpError(409, "duplicate", "Another category already uses that name.", {
      name: "Name already in use",
    });

  // Never orphan tools: subcategories in use cannot be removed, and a category with live tools cannot be archived.
  const used = await readSafe(() =>
    d
      .prepare(
        "SELECT DISTINCT subcategory AS s FROM tools WHERE category_id = ? AND subcategory IS NOT NULL",
      )
      .bind(existing.id)
      .all<{ s: string }>(),
  );
  const missing = used.results.map((r) => r.s).filter((s) => !input.subcategories.includes(s));
  if (missing.length)
    throw new HttpError(
      409,
      "subcategory_in_use",
      `These subcategories still have tools and cannot be removed: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}.`,
      { subcategories: "Subcategory is in use" },
    );
  if (input.status === "archived" && existing.status !== "archived") {
    const live =
      (
        await readSafe(() =>
          d
            .prepare(
              "SELECT count(*) AS n FROM tools WHERE category_id = ? AND status <> 'archived'",
            )
            .bind(existing.id)
            .first<{ n: number }>(),
        )
      )?.n ?? 0;
    if (live > 0)
      throw new HttpError(
        409,
        "category_not_empty",
        `${live} tool(s) in this category are not archived. Move or archive them first.`,
        { status: "Category still has tools" },
      );
  }
  await writeBatch(d, [
    {
      sql: "UPDATE categories SET name = ?, description = ?, subcategories = ?, sort_order = ?, status = ?, indexing = ?, seo_title = ?, seo_description = ?, intro = ?, faqs = ?, updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [
        input.name,
        input.description,
        JSON.stringify(input.subcategories),
        input.sort_order,
        input.status,
        input.indexing,
        input.seo_title,
        input.seo_description,
        // fields the form did not send keep their stored values
        input.intro === undefined ? (existing.intro ?? null) : input.intro,
        input.faqs === undefined
          ? (existing.faqs ?? null)
          : input.faqs?.length
            ? JSON.stringify(input.faqs)
            : null,
        ctx.now,
        slug,
        input.updated_at,
      ],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      "category.update",
      "category",
      slug,
      `Edited category "${input.name}"`,
      ctx.now,
      { table: "categories", key: "slug", value: slug, stamp: "updated_at" },
    ),
    catalogVersionStep(ctx.now), // public site re-reads the catalogue
  ]);
  return { category: await catRow(d, slug) };
}

/** A category can be deleted only when no tool (in any status) belongs to it; the FK would refuse it anyway. */
export async function deleteCategory(ctx: Ctx, slug: string, input: DeleteInput) {
  const d = need(ctx.db);
  checkConfirm(slug, input);
  const existing = await catRow(d, slug);
  const n =
    (
      await readSafe(() =>
        d
          .prepare("SELECT count(*) AS n FROM tools WHERE category_id = ?")
          .bind(existing.id)
          .first<{ n: number }>(),
      )
    )?.n ?? 0;
  if (n > 0)
    throw new HttpError(
      409,
      "category_not_empty",
      `${n} tool(s) still belong to this category. Move or delete them first.`,
    );
  return deleteGuarded(
    ctx,
    d,
    "categories",
    "NOT EXISTS (SELECT 1 FROM tools t WHERE t.category_id = categories.id)",
    {
      type: "category",
      action: "category.delete",
      slug,
      summary: `Deleted category "${existing.name}"`,
    },
    input.updated_at,
  );
}

// ---------------------------------------------------------------- blog

const shapePost = (r: Row): Row => ({ ...r, tags: parseJson(r.tags) ?? [] });

export async function listPosts(db: AdminDb | null, p: Record<string, string | undefined>) {
  const d = need(db);
  const where: string[] = [];
  const params: unknown[] = [];
  const q = (p.q ?? "").trim().slice(0, 100);
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  if (p.status && ["draft", "published", "archived"].includes(p.status)) {
    where.push("status = ?");
    params.push(p.status);
  }
  const pageSize = clampInt(p["pageSize"], 1, 100, 25);
  const page = clampInt(p["page"], 1, 100000, 1);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return readSafe(async () => {
    const total =
      (
        await d
          .prepare(`SELECT count(*) AS n FROM blog_posts ${w}`)
          .bind(...params)
          .first<{ n: number }>()
      )?.n ?? 0;
    const rows = await d
      .prepare(
        `SELECT id, slug, title, status, published_at, updated_at FROM blog_posts ${w} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<Row>();
    return { items: rows.results, total, page, pageSize };
  });
}

export async function getPost(db: AdminDb | null, slug: string) {
  const d = need(db);
  const row = await readSafe(() =>
    d
      .prepare(
        "SELECT p.*, m.mime AS cover_mime FROM blog_posts p LEFT JOIN media m ON m.id = p.cover_image_id WHERE p.slug = ?",
      )
      .bind(slug)
      .first<Row>(),
  );
  if (!row) throw new HttpError(404, "not_found", "Post not found.");
  return shapePost(row);
}

const POST_COLS = [
  "title",
  "excerpt",
  "body_md",
  "author_name",
  "tags",
  "seo_title",
  "seo_description",
  "canonical_url",
  "cover_image_id",
  "cover_alt",
] as const;
const postValues = (i: Row) =>
  POST_COLS.map((k) => (k === "tags" ? JSON.stringify(i.tags ?? []) : (i[k] ?? null)));

export async function createPost(ctx: Ctx, input: z.infer<typeof blogCreateSchema>) {
  const d = need(ctx.db);
  const id = `post-${input.client_id.toLowerCase()}`;
  const byId = await readSafe(() =>
    d.prepare("SELECT slug FROM blog_posts WHERE id = ?").bind(id).first<Row>(),
  );
  if (byId) {
    if (byId.slug === input.slug) return { post: await getPost(d, input.slug), created: false };
    throw new HttpError(
      409,
      "duplicate",
      "This form was already submitted with a different slug. Reload the page.",
    );
  }
  const taken = await readSafe(() =>
    d.prepare("SELECT 1 AS x FROM blog_posts WHERE slug = ?").bind(input.slug).first<Row>(),
  );
  if (taken)
    throw new HttpError(409, "slug_taken", "That slug is already used by another post.", {
      slug: "Slug already in use",
    });
  await writeBatch(d, [
    {
      sql: `INSERT INTO blog_posts (id, slug, ${POST_COLS.join(",")}, status, created_at, updated_at) VALUES (?, ?, ${POST_COLS.map(() => "?").join(",")}, 'draft', ?, ?)`,
      params: [id, input.slug, ...postValues(input), ctx.now, ctx.now],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      "post.create",
      "post",
      input.slug,
      `Created draft post "${input.title}"`,
      ctx.now,
      { table: "blog_posts", key: "id", value: id, stamp: "created_at" },
    ),
    contentVersionStep(ctx.now),
  ]);
  return { post: await getPost(d, input.slug), created: true };
}

export async function updatePost(ctx: Ctx, slug: string, input: z.infer<typeof blogUpdateSchema>) {
  const d = need(ctx.db);
  await getPost(d, slug);
  await writeBatch(d, [
    {
      sql: `UPDATE blog_posts SET ${POST_COLS.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE slug = ? AND updated_at = ?`,
      params: [...postValues(input), ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(ctx.actor, "post.update", "post", slug, `Edited post "${input.title}"`, ctx.now, {
      table: "blog_posts",
      key: "slug",
      value: slug,
      stamp: "updated_at",
    }),
    contentVersionStep(ctx.now),
  ]);
  return { post: await getPost(d, slug) };
}

export async function applyPostAction(
  ctx: Ctx,
  slug: string,
  input: z.infer<typeof blogActionSchema>,
) {
  const d = need(ctx.db);
  const row = await getPost(d, slug);
  const bad = (m: string) => new HttpError(409, "invalid_transition", m);
  let status = row.status as string;
  let publishedAt = (row.published_at as string | null) ?? null;
  switch (input.action) {
    case "publish":
      if (status !== "draft") throw bad("Only drafts can be published.");
      if (
        !String(row.title ?? "").trim() ||
        !String(row.excerpt ?? "").trim() ||
        !String(row.body_md ?? "").trim()
      )
        throw new HttpError(
          422,
          "not_publishable",
          "Title, excerpt and body are required before publishing.",
        );
      status = "published";
      publishedAt = publishedAt ?? ctx.now; // keep the original date when re-publishing
      break;
    case "unpublish":
      if (status !== "published") throw bad("Only published posts can be unpublished.");
      status = "draft";
      break;
    case "archive":
      if (status === "archived") throw bad("Already archived.");
      status = "archived";
      break;
    case "restore":
      if (status !== "archived") throw bad("Only archived posts can be restored.");
      status = "draft";
      break;
  }
  await writeBatch(d, [
    {
      sql: "UPDATE blog_posts SET status = ?, published_at = ?, updated_at = ? WHERE slug = ? AND updated_at = ?",
      params: [status, publishedAt, ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      `post.${input.action}`,
      "post",
      slug,
      `${input.action} "${row.title}"`,
      ctx.now,
      { table: "blog_posts", key: "slug", value: slug, stamp: "updated_at" },
    ),
    contentVersionStep(ctx.now),
  ]);
  return { post: await getPost(d, slug) };
}

/** Published posts must be unpublished first; drafts and archived posts can be deleted. */
export async function deletePost(ctx: Ctx, slug: string, input: DeleteInput) {
  const d = need(ctx.db);
  checkConfirm(slug, input);
  const row = await getPost(d, slug);
  if (row.status === "published")
    throw new HttpError(409, "is_published", "Unpublish the post before deleting it.");
  return deleteGuarded(
    ctx,
    d,
    "blog_posts",
    "status IN ('draft','archived')",
    { type: "post", action: "post.delete", slug, summary: `Deleted post "${row.title}"` },
    input.updated_at,
  );
}
