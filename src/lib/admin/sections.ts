// Courses & books, gadgets and sponsored guest articles: ONE implementation of list / get / create / update / workflow
// actions / delete, configured per section. Same guarantees as the blog code in repo.ts: idempotent create (client_id),
// optimistic concurrency (updated_at), an audit row written only when the change happened, and contentVersionStep() in
// the same batch so the static site re-checks these pages. Table and column names come from the fixed configs below,
// never from request data.
import { auditStep, contentVersionStep, HttpError, readSafe, writeBatch, type AdminDb } from "./db";
import {
  checkConfirm,
  clampInt,
  deleteGuarded,
  likePattern,
  need,
  parseJson,
  type Ctx,
  type DeleteInput,
  type Row,
} from "./repo";

type Table = "courses" | "gadgets" | "guest_articles" | "tutorials";

export type SectionConfig = {
  table: Table;
  /** audit entity_type and action prefix */
  entity: "course" | "gadget" | "guest_article" | "tutorial";
  noun: string;
  /** editable columns, in insert/update order */
  cols: readonly string[];
  json: readonly string[];
  bools: readonly string[];
  /** the image column joined to media for previews */
  imageCol: "image_id" | "cover_image_id";
  listCols: string;
  statuses: readonly string[];
  hasReview: boolean;
  /** Why this row cannot be published yet, or null. */
  publishBlocker: (row: Row) => string | null;
};

const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export const SECTIONS = {
  courses: {
    table: "courses",
    entity: "course",
    noun: "course",
    cols: [
      "kind",
      "title",
      "provider_or_author",
      "summary",
      "review_md",
      "level",
      "format",
      "duration",
      "price_text",
      "is_free",
      "affiliate_url",
      "affiliate_network",
      "image_id",
      "topics",
      "featured",
      "sort_order",
      "indexing",
      "seo_title",
      "seo_description",
    ],
    json: ["topics"],
    bools: ["is_free", "featured"],
    imageCol: "image_id",
    listCols: "id, slug, title, kind, status, indexing, featured, published_at, updated_at",
    statuses: ["draft", "published", "archived"],
    hasReview: false,
    publishBlocker: (r) =>
      filled(r["title"]) && filled(r["summary"]) && filled(r["affiliate_url"])
        ? null
        : "Title, summary and the course/book link are required before publishing.",
  },
  gadgets: {
    table: "gadgets",
    entity: "gadget",
    noun: "gadget",
    cols: [
      "title",
      "brand",
      "gadget_type",
      "summary",
      "features",
      "review_md",
      "price_text",
      "retailer",
      "affiliate_url",
      "alt_retailers",
      "image_id",
      "featured",
      "sort_order",
      "indexing",
      "seo_title",
      "seo_description",
    ],
    json: ["features", "alt_retailers"],
    bools: ["featured"],
    imageCol: "image_id",
    listCols: "id, slug, title, gadget_type, status, indexing, featured, published_at, updated_at",
    statuses: ["draft", "published", "archived"],
    hasReview: false,
    publishBlocker: (r) =>
      filled(r["title"]) && filled(r["summary"]) && filled(r["affiliate_url"])
        ? null
        : "Title, summary and the retailer link are required before publishing.",
  },
  "guest-articles": {
    table: "guest_articles",
    entity: "guest_article",
    noun: "article",
    cols: [
      "title",
      "excerpt",
      "body_md",
      "cover_image_id",
      "cover_alt",
      "topic",
      "contributor_name",
      "contributor_email",
      "sponsor_name",
      "sponsor_url",
      "sponsor_label",
      "payment_status",
      "payment_ref",
      "indexing",
      "seo_title",
      "seo_description",
      "canonical_url",
    ],
    json: [],
    bools: [],
    imageCol: "cover_image_id",
    listCols:
      "id, slug, title, contributor_name, sponsor_name, status, payment_status, published_at, updated_at",
    statuses: ["draft", "review", "published", "archived"],
    hasReview: true,
    publishBlocker: (r) =>
      r["payment_status"] !== "paid"
        ? "Mark the payment as paid before publishing a sponsored article."
        : filled(r["title"]) && filled(r["excerpt"]) && filled(r["body_md"])
          ? null
          : "Title, excerpt and body are required before publishing.",
  },
  tutorials: {
    table: "tutorials",
    entity: "tutorial",
    noun: "tutorial",
    cols: [
      "title",
      "author_or_provider",
      "summary",
      "body_md",
      "difficulty",
      "format",
      "duration",
      "resource_url",
      "is_affiliate",
      "is_free",
      "image_id",
      "topics",
      "featured",
      "sort_order",
      "indexing",
      "seo_title",
      "seo_description",
    ],
    json: ["topics"],
    bools: ["is_affiliate", "is_free", "featured"],
    imageCol: "image_id",
    listCols: "id, slug, title, difficulty, status, indexing, featured, published_at, updated_at",
    statuses: ["draft", "published", "archived"],
    hasReview: false,
    // Either the tutorial itself (a real body) or a link to it elsewhere: never an empty page.
    publishBlocker: (r) =>
      !filled(r["title"]) || !filled(r["summary"])
        ? "Title and summary are required before publishing."
        : filled(r["resource_url"]) || String(r["body_md"] ?? "").trim().length >= 300
          ? null
          : "Add the tutorial link, or write at least 300 characters of tutorial, before publishing.",
  },
} as const satisfies Record<string, SectionConfig>;

export type SectionKey = keyof typeof SECTIONS;
export const isSectionKey = (v: string): v is SectionKey => Object.hasOwn(SECTIONS, v);

const values = (sec: SectionConfig, input: Row): unknown[] =>
  sec.cols.map((c) => {
    const v = input[c];
    if (sec.json.includes(c)) return JSON.stringify(v ?? []);
    if (sec.bools.includes(c)) return v ? 1 : 0;
    return v ?? null;
  });

function shape(sec: SectionConfig, r: Row): Row {
  const out: Row = { ...r };
  for (const c of sec.json) out[c] = parseJson(r[c]) ?? [];
  for (const c of sec.bools) out[c] = r[c] === 1;
  return out;
}

export async function listSection(
  db: AdminDb | null,
  sec: SectionConfig,
  p: Record<string, string | undefined>,
) {
  const d = need(db);
  const where: string[] = [];
  const params: unknown[] = [];
  const q = (p["q"] ?? "").trim().slice(0, 100);
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }
  if (p["status"] && sec.statuses.includes(p["status"])) {
    where.push("status = ?");
    params.push(p["status"]);
  }
  const pageSize = clampInt(p["pageSize"], 1, 100, 25);
  const page = clampInt(p["page"], 1, 100000, 1);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return readSafe(async () => {
    const [count, rows] = await Promise.all([
      d
        .prepare(`SELECT count(*) AS n FROM ${sec.table} ${w}`)
        .bind(...params)
        .first<{ n: number }>(),
      d
        .prepare(
          `SELECT ${sec.listCols} FROM ${sec.table} ${w} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        )
        .bind(...params, pageSize, (page - 1) * pageSize)
        .all<Row>(),
    ]);
    return {
      items: rows.results.map((r) => shape(sec, r)),
      total: count?.n ?? 0,
      page,
      pageSize,
    };
  });
}

export async function getItem(db: AdminDb | null, sec: SectionConfig, slug: string) {
  const d = need(db);
  const row = await readSafe(() =>
    d
      .prepare(
        `SELECT x.*, m.mime AS image_mime FROM ${sec.table} x LEFT JOIN media m ON m.id = x.${sec.imageCol} WHERE x.slug = ?`,
      )
      .bind(slug)
      .first<Row>(),
  );
  if (!row) throw new HttpError(404, "not_found", `The ${sec.noun} was not found.`);
  return shape(sec, row);
}

export async function createItem(ctx: Ctx, sec: SectionConfig, input: Row) {
  const d = need(ctx.db);
  const slug = String(input["slug"]);
  const id = `${sec.entity}-${String(input["client_id"]).toLowerCase()}`;
  const byId = await readSafe(() =>
    d.prepare(`SELECT slug FROM ${sec.table} WHERE id = ?`).bind(id).first<Row>(),
  );
  if (byId) {
    if (byId["slug"] === slug) return { item: await getItem(d, sec, slug), created: false };
    throw new HttpError(
      409,
      "duplicate",
      "This form was already submitted with a different slug. Reload the page.",
    );
  }
  const taken = await readSafe(() =>
    d.prepare(`SELECT 1 AS x FROM ${sec.table} WHERE slug = ?`).bind(slug).first<Row>(),
  );
  if (taken)
    throw new HttpError(409, "slug_taken", `That slug is already used by another ${sec.noun}.`, {
      slug: "Slug already in use",
    });
  await writeBatch(d, [
    {
      sql: `INSERT INTO ${sec.table} (id, slug, ${sec.cols.join(",")}, status, created_at, updated_at) VALUES (?, ?, ${sec.cols.map(() => "?").join(",")}, 'draft', ?, ?)`,
      params: [id, slug, ...values(sec, input), ctx.now, ctx.now],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      `${sec.entity}.create`,
      sec.entity,
      slug,
      `Created draft ${sec.noun} "${String(input["title"])}"`,
      ctx.now,
      { table: sec.table, key: "id", value: id, stamp: "created_at" },
    ),
    contentVersionStep(ctx.now),
  ]);
  return { item: await getItem(d, sec, slug), created: true };
}

export async function updateItem(ctx: Ctx, sec: SectionConfig, slug: string, input: Row) {
  const d = need(ctx.db);
  const row = await getItem(d, sec, slug);
  // A published guest article must stay paid (the database refuses it too; this gives a clear message).
  if (
    sec.table === "guest_articles" &&
    row["status"] === "published" &&
    input["payment_status"] !== "paid"
  )
    throw new HttpError(409, "is_published", "Unpublish the article before changing its payment.", {
      payment_status: "Must stay paid while published",
    });
  await writeBatch(d, [
    {
      sql: `UPDATE ${sec.table} SET ${sec.cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE slug = ? AND updated_at = ?`,
      params: [...values(sec, input), ctx.now, slug, input["updated_at"]],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      `${sec.entity}.update`,
      sec.entity,
      slug,
      `Edited ${sec.noun} "${String(input["title"])}"`,
      ctx.now,
      { table: sec.table, key: "slug", value: slug, stamp: "updated_at" },
    ),
    contentVersionStep(ctx.now),
  ]);
  return { item: await getItem(d, sec, slug) };
}

export async function applySectionAction(
  ctx: Ctx,
  sec: SectionConfig,
  slug: string,
  input: { action: string; updated_at: string },
) {
  const d = need(ctx.db);
  const row = await getItem(d, sec, slug);
  const bad = (m: string) => new HttpError(409, "invalid_transition", m);
  let status = String(row["status"]);
  let publishedAt = (row["published_at"] as string | null) ?? null;
  switch (input.action) {
    case "send_to_review":
      if (!sec.hasReview) throw bad("This section has no review step.");
      if (status !== "draft") throw bad("Only drafts can be sent to review.");
      status = "review";
      break;
    case "publish": {
      if (status !== "draft" && status !== "review")
        throw bad("Only drafts (or articles in review) can be published.");
      const blocker = sec.publishBlocker(row);
      if (blocker) throw new HttpError(422, "not_publishable", blocker);
      status = "published";
      publishedAt = publishedAt ?? ctx.now; // keep the original date when re-publishing
      break;
    }
    case "unpublish":
      if (status !== "published") throw bad(`Only a published ${sec.noun} can be unpublished.`);
      status = "draft";
      break;
    case "archive":
      if (status === "archived") throw bad("Already archived.");
      status = "archived";
      break;
    case "restore":
      if (status !== "archived") throw bad(`Only an archived ${sec.noun} can be restored.`);
      status = "draft";
      break;
    default:
      throw bad("Unknown action.");
  }
  await writeBatch(d, [
    {
      sql: `UPDATE ${sec.table} SET status = ?, published_at = ?, updated_at = ? WHERE slug = ? AND updated_at = ?`,
      params: [status, publishedAt, ctx.now, slug, input.updated_at],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      `${sec.entity}.${input.action}`,
      sec.entity,
      slug,
      `${input.action} "${String(row["title"])}"`,
      ctx.now,
      { table: sec.table, key: "slug", value: slug, stamp: "updated_at" },
    ),
    contentVersionStep(ctx.now),
  ]);
  return { item: await getItem(d, sec, slug) };
}

/** Published entries must be unpublished first; drafts, entries in review and archived ones can be deleted. */
export async function deleteItem(ctx: Ctx, sec: SectionConfig, slug: string, input: DeleteInput) {
  const d = need(ctx.db);
  checkConfirm(slug, input);
  const row = await getItem(d, sec, slug);
  if (row["status"] === "published")
    throw new HttpError(409, "is_published", `Unpublish the ${sec.noun} before deleting it.`);
  return deleteGuarded(
    ctx,
    d,
    sec.table,
    "status IN ('draft','review','archived')",
    {
      type: sec.entity,
      action: `${sec.entity}.delete`,
      slug,
      summary: `Deleted ${sec.noun} "${String(row["title"])}"`,
    },
    input.updated_at,
  );
}
