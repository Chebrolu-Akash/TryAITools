import type { ZodTypeAny, z } from "zod";
import { authenticate, checkCsrf, type AuthDeps } from "./auth";
import { HttpError, type AdminDb } from "./db";
import * as repo from "./repo";
import {
  blogActionSchema,
  blogCreateSchema,
  blogUpdateSchema,
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
};

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

    const csrf = checkCsrf(request);
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
    if (a === "stats" && segs.length === 1)
      return (allow("GET"), respond(200, await repo.getStats(db)));

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
    return fail(404, "not_found", "Not found.");
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.fields);
    console.error("admin api: unexpected error");
    return fail(500, "internal_error", "Something went wrong. Nothing was saved.");
  }
}
