import { readAdminConfig, readOwners, type AdminConfig } from "./config";
import { AccessJwtError, createJwksProvider, verifyAccessJwt, type JwksProvider } from "./jwt";

export type AuthMode = "access" | "local-dev";
export type AuthResult =
  | { ok: true; email: string; mode: AuthMode }
  | { ok: false; status: 401 | 403 | 503; code: string };

export type AuthDeps = { jwks?: JwksProvider; nowSeconds?: number };

const providers = new Map<string, JwksProvider>();
function providerFor(config: AdminConfig): JwksProvider {
  let p = providers.get(config.jwksUrl);
  if (!p) providers.set(config.jwksUrl, (p = createJwksProvider({ url: config.jwksUrl })));
  return p;
}

/** The token Access injects: header first, then the CF_Authorization cookie. Nothing else is read. */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === "CF_Authorization") return part.slice(i + 1).trim();
    }
  }
  return null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * LOCAL DEVELOPMENT SIGN-IN (there is no Cloudflare Access on a developer machine). Returns null, so the normal
 * Access check runs, unless ALL of these hold:
 *   - ADMIN_LOCAL_DEV_EMAIL is set (only ever in the git-ignored .dev.vars; never a Worker secret or variable)
 *   - the request is addressed to localhost / 127.0.0.1 / [::1] (Cloudflare never routes those hostnames)
 *   - the request carries no Cf-Ray header (every request that passed through Cloudflare's edge has one)
 * The email must still be on OWNER_EMAILS, and CSRF checks still apply to writes.
 */
export function localDevAuth(request: Request, env: Record<string, unknown>): AuthResult | null {
  const raw = env.ADMIN_LOCAL_DEV_EMAIL;
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (!LOCAL_HOSTS.has(new URL(request.url).hostname) || request.headers.has("cf-ray")) {
    console.error("admin auth: ADMIN_LOCAL_DEV_EMAIL is set but ignored (not a local request)");
    return null;
  }
  const email = raw.trim().toLowerCase();
  const owners = readOwners(env);
  if (!owners) return { ok: false, status: 503, code: "admin_not_configured" };
  if (!owners.includes(email)) return { ok: false, status: 403, code: "forbidden" };
  return { ok: true, email, mode: "local-dev" };
}

/**
 * Authenticates AND authorizes the caller. Order matters and everything fails closed:
 *   missing config -> 503 | no token -> 401 | invalid token -> 401 | JWKS unreachable -> 503 | not an owner -> 403
 * Identity headers such as Cf-Access-Authenticated-User-Email are deliberately never consulted.
 */
export async function authenticate(
  request: Request,
  env: Record<string, unknown>,
  deps: AuthDeps = {},
): Promise<AuthResult> {
  const local = localDevAuth(request, env);
  if (local) return local;
  const cfg = readAdminConfig(env);
  if (!cfg.ok) {
    console.error("admin auth: configuration incomplete:", cfg.missing.join(", "));
    return { ok: false, status: 503, code: "admin_not_configured" };
  }
  const token = extractAccessToken(request);
  if (!token) return { ok: false, status: 401, code: "unauthenticated" };

  try {
    const { email } = await verifyAccessJwt(token, {
      issuer: cfg.config.issuer,
      audiences: cfg.config.audiences,
      jwks: deps.jwks ?? providerFor(cfg.config),
      nowSeconds: deps.nowSeconds,
    });
    if (!cfg.config.owners.includes(email)) return { ok: false, status: 403, code: "forbidden" };
    return { ok: true, email, mode: "access" };
  } catch (e) {
    if (e instanceof AccessJwtError && e.code === "jwks_unavailable") {
      console.error("admin auth: signing keys unavailable");
      return { ok: false, status: 503, code: "auth_unavailable" };
    }
    return { ok: false, status: 401, code: "invalid_token" };
  }
}

/**
 * CSRF defence for state-changing requests (the Access session is a cookie, so this is required):
 * custom header (forces a CORS preflight that we never grant) + same-origin Origin + JSON body.
 */
export function checkCsrf(
  request: Request,
): { ok: true } | { ok: false; status: 403 | 415; code: string } {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { ok: true };
  if (request.headers.get("x-requested-with") !== "tryaitools-admin")
    return { ok: false, status: 403, code: "csrf_header_missing" };
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin) {
    if (origin !== expected) return { ok: false, status: 403, code: "csrf_origin_mismatch" };
  } else if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return { ok: false, status: 403, code: "csrf_origin_missing" };
  }
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type))
    return { ok: false, status: 415, code: "json_required" };
  return { ok: true };
}
