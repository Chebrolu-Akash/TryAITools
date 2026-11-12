import type { ZodTypeAny, z } from "zod";
import { authenticate, checkCsrf, type AuthDeps } from "./auth";
import { handleDbCheck } from "../db/check";
import { databaseUnavailable, HttpError, type AdminDb } from "./db";
import { MAX_MEDIA_BYTES } from "@/lib/media";
import { deleteMedia, listMedia, uploadMedia, type MediaBucket } from "./media";
import {
  applySectionAction,
  createItem,
  deleteItem,
  getItem,
  isSectionKey,
  listSection,
  SECTIONS,
  updateItem,
} from "./sections";
import * as repo from "./repo";
import * as bulk from "./bulk";
import * as review from "./review";
import * as news from "@/lib/news/admin";
import { summarizerFromEnv } from "@/lib/news/cron";
import { configFromEnv, runIngestion } from "@/lib/news/ingest";
import type { Summarizer } from "@/lib/news/summarize";
import {
  blogActionSchema,
  blogCreateSchema,
  blogUpdateSchema,
  courseCreateSchema,
  courseUpdateSchema,
  gadgetCreateSchema,
  gadgetUpdateSchema,
  guestCreateSchema,
  guestUpdateSchema,
  tutorialCreateSchema,
  tutorialUpdateSchema,
  mediaAltSchema,
  sectionActionSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  deleteSchema,
  fieldErrors,
  toolActionSchema,
  toolCreateSchema,
  toolUpdateSchema,
} from "./validation";

export const MAX_BODY_BYTES = 200_000;
const PREFIX = "/api/admin/";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AdminApiDeps = {
  env: () => Promise<Record<string, unknown>>;
  db: () => Promise<AdminDb | null>;
  now?: () => string;
  auth?: AuthDeps;
  /** The R2 bucket for uploaded images; defaults to the MEDIA binding. */
  media?: () => Promise<MediaBucket | null>;
  /** The AI News summariser for "Run now" / "Retry"; defaults to one built from GEMINI_API_KEY (null if unset). */
  newsSummarizer?: () => Promise<Summarizer | null>;
  /** fetch used by a manual news run (tests); defaults to the global fetch. */
  newsFetch?: typeof fetch;
  /** fetch used for review drafts (tests); defaults to the global fetch. */
  reviewFetch?: typeof fetch;
};

const SECTION_SCHEMAS = {
  courses: { create: courseCreateSchema, update: courseUpdateSchema },
  gadgets: { create: gadgetCreateSchema, update: gadgetUpdateSchema },
  "guest-articles": { create: guestCreateSchema, update: guestUpdateSchema },
  tutorials: { create: tutorialCreateSchema, update: tutorialUpdateSchema },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  respond(status, { error: { code, message, ...(fields ? { fields } : {}) } });

async function readJson<S extends ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES)
    throw new HttpError(413, "payload_too_large", "The request is too large.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES)
    throw new HttpError(413, "payload_too_large", "The request is too large.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new HttpError(
      422,
      "validation_failed",
      "Please fix the highlighted fields.",
      fieldErrors(parsed.error),
    );
  return parsed.data;
}

/**
 * Single entry point for every /api/admin/* request. Order is fixed and never skipped:
 *   1. authenticate + authorize (Access JWT verified server-side, owner allowlist)
 *   2. CSRF checks for state-changing methods
 *   3. route, validate, write
 * Because authorization happens BEFORE routing, an unauthenticated caller gets 401 for any path,
 * including paths that do not exist, so the API surface cannot be probed.
 */
export async function handleAdminApi(request: Request, deps: AdminApiDeps): Promise<Response> {
  const url = new URL(request.url);
  try {
    const auth = await authenticate(request, await deps.env(), deps.auth);
    if (!auth.ok)
      return fail(
        auth.status,
        auth.code,
        auth.status === 503
          ? "Admin access is not available right now."
          : auth.status === 403
            ? "Your account is not authorized for the admin."
            : "Authentication required.",
      );

    const csrf = checkCsrf(request, {
      allowImage: url.pathname === `${PREFIX}media` && request.method.toUpperCase() === "POST",
    });
    if (!csrf.ok) return fail(csrf.status, csrf.code, "The request was rejected.");

    if (!url.pathname.startsWith(PREFIX)) return fail(404, "not_found", "Not found.");
    const segs = url.pathname
      .slice(PREFIX.length)
      .split("/")
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          throw new HttpError(400, "invalid_path", "Invalid path.");
        }
      });
    const method = request.method.toUpperCase();
    const q = Object.fromEntries(url.searchParams.entries());
    const db = await deps.db();
    const ctx = () => ({
      db,
      actor: auth.email,
      now: (deps.now ?? (() => new Date().toISOString()))(),
    });
    const slugAt = (i: number) => {
      const s = segs[i];
      if (!s || !SLUG.test(s) || s.length > 80)
        throw new HttpError(400, "invalid_slug", "Invalid slug.");
      return s;
    };
    const allow = (...m: string[]) => {
      if (!m.includes(method))
        throw new HttpError(405, "method_not_allowed", "Method not allowed.");
    };

    const [a, , c] = segs;
    if (a === "session" && segs.length === 1)
      return (allow("GET"), respond(200, { email: auth.email, mode: auth.mode }));
    // D1 binding diagnostic (was the public /api/db-check): now behind Access and the owner allowlist like the rest.
    if (a === "db-check" && segs.length === 1)
      return (allow("GET"), handleDbCheck(request, async () => ({ db, source: "admin" })));
    if (a === "stats" && segs.length === 1)
      return (allow("GET"), respond(200, await repo.getStats(db)));

    // Bulk tool management (src/lib/admin/bulk.ts): select, dry-run preview, chunked apply, finish, undo.
    if (a === "bulk") {
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      const opAt = (i: number) => {
        const v = segs[i];
        if (!v || !UUID.test(v)) throw new HttpError(400, "invalid_id", "Invalid operation id.");
        return v;
      };
      if (segs.length === 2 && segs[1] === "select")
        return (allow("GET"), respond(200, await bulk.selectMatching(db, q)));
      if (segs.length === 2 && segs[1] === "preview") {
        allow("POST");
        return respond(
          200,
          await bulk.previewBulk(db, await readJson(request, bulk.bulkEditSchema)),
        );
      }
      if (segs.length === 2 && segs[1] === "operations") {
        if (method === "GET") return respond(200, await bulk.listOperations(db, q));
        allow("POST");
        return respond(
          201,
          await bulk.startOperation(ctx(), await readJson(request, bulk.bulkStartSchema)),
        );
      }
      if (segs.length === 4 && segs[1] === "operations") {
        allow("POST");
        const id = opAt(2);
        if (segs[3] === "apply")
          return respond(
            200,
            await bulk.applyChunk(ctx(), id, await readJson(request, bulk.bulkApplySchema)),
          );
        if (segs[3] === "finish") return respond(200, await bulk.finishOperation(ctx(), id));
        if (segs[3] === "undo")
          return respond(
            200,
            await bulk.undoChunk(ctx(), id, await readJson(request, bulk.bulkUndoSchema)),
          );
      }
      throw new HttpError(404, "not_found", "Not found.");
    }

    if (a === "tools") {
      if (segs.length === 1) {
        if (method === "GET") return respond(200, await repo.listTools(db, q));
        allow("POST");
        const r = await repo.createTool(ctx(), await readJson(request, toolCreateSchema));
        return respond(r.created ? 201 : 200, r);
      }
      if (segs.length === 2) {
        const slug = slugAt(1);
        if (method === "GET") return respond(200, { tool: await repo.getTool(db, slug) });
        if (method === "DELETE")
          return respond(
            200,
            await repo.deleteTool(ctx(), slug, await readJson(request, deleteSchema)),
          );
        allow("PUT");
        return respond(
          200,
          await repo.updateTool(ctx(), slug, await readJson(request, toolUpdateSchema)),
        );
      }
      // Review drafts: generate (Gemini free tier, grounded in the official pages), approve, reject.
      if (segs.length === 3 && c === "draft") {
        allow("POST");
        const env = await deps.env();
        const key = typeof env["GEMINI_API_KEY"] === "string" ? env["GEMINI_API_KEY"].trim() : "";
        const model = typeof env["NEWS_MODEL"] === "string" ? env["NEWS_MODEL"] : undefined;
        return respond(
          200,
          await review.generateToolDraft(ctx(), slugAt(1), {
            apiKey: key || null,
            model,
            ...(deps.reviewFetch ? { fetch: deps.reviewFetch } : {}),
          }),
        );
      }
      if (segs.length === 4 && c === "draft" && (segs[3] === "approve" || segs[3] === "reject")) {
        allow("POST");
        const input = await readJson(request, review.draftDecisionSchema);
        return respond(
          200,
          segs[3] === "approve"
            ? await review.approveToolDraft(ctx(), slugAt(1), input)
            : await review.rejectToolDraft(ctx(), slugAt(1), input),
        );
      }
      if (segs.length === 3 && c === "action") {
        allow("POST");
        return respond(
          200,
          await repo.applyToolAction(ctx(), slugAt(1), await readJson(request, toolActionSchema)),
        );
      }
    }

    if (a === "categories") {
      if (segs.length === 1) {
        if (method === "GET") return respond(200, await repo.listCategories(db));
        allow("POST");
        return respond(
          201,
          await repo.createCategory(ctx(), await readJson(request, categoryCreateSchema)),
        );
      }
      if (segs.length === 2) {
        if (method === "DELETE")
          return respond(
            200,
            await repo.deleteCategory(ctx(), slugAt(1), await readJson(request, deleteSchema)),
          );
        allow("PUT");
        return respond(
          200,
          await repo.updateCategory(
            ctx(),
            slugAt(1),
            await readJson(request, categoryUpdateSchema),
          ),
        );
      }
    }

    if (a === "blog") {
      if (segs.length === 1) {
        if (method === "GET") return respond(200, await repo.listPosts(db, q));
        allow("POST");
        const r = await repo.createPost(ctx(), await readJson(request, blogCreateSchema));
        return respond(r.created ? 201 : 200, r);
      }
      if (segs.length === 2) {
        const slug = slugAt(1);
        if (method === "GET") return respond(200, { post: await repo.getPost(db, slug) });
        if (method === "DELETE")
          return respond(
            200,
            await repo.deletePost(ctx(), slug, await readJson(request, deleteSchema)),
          );
        allow("PUT");
        return respond(
          200,
          await repo.updatePost(ctx(), slug, await readJson(request, blogUpdateSchema)),
        );
      }
      if (segs.length === 3 && c === "action") {
        allow("POST");
        return respond(
          200,
          await repo.applyPostAction(ctx(), slugAt(1), await readJson(request, blogActionSchema)),
        );
      }
    }
    if (a && isSectionKey(a)) {
      const sec = SECTIONS[a];
      const schemas = SECTION_SCHEMAS[a];
      if (segs.length === 1) {
        if (method === "GET") return respond(200, await listSection(db, sec, q));
        allow("POST");
        const r = await createItem(ctx(), sec, await readJson(request, schemas.create));
        return respond(r.created ? 201 : 200, r);
      }
      if (segs.length === 2) {
        const slug = slugAt(1);
        if (method === "GET") return respond(200, { item: await getItem(db, sec, slug) });
        if (method === "DELETE")
          return respond(
            200,
            await deleteItem(ctx(), sec, slug, await readJson(request, deleteSchema)),
          );
        allow("PUT");
        return respond(
          200,
          await updateItem(ctx(), sec, slug, await readJson(request, schemas.update)),
        );
      }
      if (segs.length === 3 && c === "action") {
        allow("POST");
        return respond(
          200,
          await applySectionAction(
            ctx(),
            sec,
            slugAt(1),
            await readJson(request, sectionActionSchema),
          ),
        );
      }
    }

    if (a === "news") {
      const sub = segs[1];
      const run = async (input: {
        source_ids?: string[] | undefined;
        article_ids?: string[] | undefined;
      }) => {
        if (!db) throw new HttpError(503, "database_unavailable", "The database is not available.");
        const env = await deps.env();
        return runIngestion({
          db,
          summarizer: deps.newsSummarizer ? await deps.newsSummarizer() : summarizerFromEnv(env),
          trigger: input.article_ids?.length ? "retry" : "manual",
          config: configFromEnv(env),
          ...(deps.newsFetch ? { fetch: deps.newsFetch } : {}),
          ...(input.source_ids?.length ? { sourceIds: input.source_ids } : {}),
          ...(input.article_ids?.length ? { articleIds: input.article_ids } : {}),
        });
      };
      if (sub === "stats" && segs.length === 2)
        return (allow("GET"), respond(200, await news.newsStats(db)));
      if (sub === "run" && segs.length === 2) {
        allow("POST");
        const report = await run(await readJson(request, news.newsRunSchema));
        return respond(report.skipped ? 409 : 200, { report });
      }
      if (sub === "sources") {
        if (segs.length === 2) return (allow("GET"), respond(200, await news.listNewsSources(db)));
        if (segs.length === 3) {
          allow("PUT");
          return respond(
            200,
            await news.updateNewsSource(
              ctx(),
              slugAt(2),
              await readJson(request, news.newsSourceUpdateSchema),
            ),
          );
        }
      }
      if (sub === "articles") {
        if (segs.length === 2)
          return (allow("GET"), respond(200, await news.listNewsArticles(db, q)));
        const id = segs[2]!;
        if (!UUID.test(id)) throw new HttpError(400, "invalid_id", "Invalid article id.");
        if (segs.length === 3)
          return (allow("GET"), respond(200, { article: await news.getNewsArticle(db, id) }));
        if (segs.length === 4 && segs[3] === "action") {
          allow("POST");
          const input = await readJson(request, news.newsArticleActionSchema);
          const result = await news.applyNewsArticleAction(ctx(), id, input);
          // Retry summarises the article right away (a run of its own, so the lock and the log apply).
          if (input.action === "retry")
            return respond(200, { ...result, report: await run({ article_ids: [id] }) });
          return respond(200, result);
        }
      }
    }

    if (a === "media") {
      const bucket = async () =>
        deps.media
          ? deps.media()
          : (((await deps.env())["MEDIA"] as MediaBucket | undefined) ?? null);
      if (segs.length === 1) {
        if (method === "GET") return respond(200, await listMedia(db, q));
        allow("POST");
        if (Number(request.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES)
          throw new HttpError(413, "payload_too_large", "Images must be 2 MB or smaller.");
        const alt = mediaAltSchema.safeParse({ alt: q["alt"] ?? null });
        if (!alt.success)
          throw new HttpError(
            422,
            "validation_failed",
            "Please fix the highlighted fields.",
            fieldErrors(alt.error),
          );
        const bytes = new Uint8Array(await request.arrayBuffer());
        return respond(201, await uploadMedia(ctx(), await bucket(), bytes, alt.data.alt));
      }
      if (segs.length === 2) {
        allow("DELETE");
        const id = segs[1]!;
        if (!UUID.test(id)) throw new HttpError(400, "invalid_id", "Invalid image id.");
        return respond(200, await deleteMedia(ctx(), await bucket(), id));
      }
    }
    return fail(404, "not_found", "Not found.");
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.fields);
    const unavailable = databaseUnavailable(e);
    if (unavailable) {
      console.error(`admin api: ${unavailable.code}`);
      return fail(unavailable.status, unavailable.code, unavailable.message);
    }
    console.error("admin api: unexpected error");
    return fail(500, "internal_error", "Something went wrong. Nothing was saved.");
  }
}
