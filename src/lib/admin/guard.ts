import { authenticate, type AuthDeps } from "./auth";

const ADMIN_PAGE = /^\/admin(\/|$)/;

/**
 * The router matches paths case-insensitively and decodes percent-escapes, so the check must too, or
 * "/Admin" or "/%61dmin" would reach the page without being guarded. Only well-formed %XX escapes are decoded
 * (a malformed one such as "%E0%A4%A" cannot spell "admin", so ordinary junk URLs are left to the router's 404).
 */
export function isAdminPagePath(pathname: string): boolean {
  let p = pathname;
  for (let i = 0; i < 3; i++) {
    const d = p.replace(/%([0-9a-f]{2})/gi, (_m, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    if (d === p) break;
    p = d;
  }
  p = p
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
  return ADMIN_PAGE.test(p);
}

const page = (status: number, title: string, text: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );

/**
 * Server-side gate for /admin pages. The admin HTML contains no data (all data comes from the verified
 * /api/admin endpoints), but it is still never served to anyone who fails the same Access JWT + owner
 * allowlist check. Returns a Response to send instead of the page, or null to let the page render.
 */
export async function guardAdminPage(
  request: Request,
  env: Record<string, unknown>,
  deps?: AuthDeps,
): Promise<Response | null> {
  if (!isAdminPagePath(new URL(request.url).pathname)) return null;
  const auth = await authenticate(request, env, deps);
  if (auth.ok) return null;
  if (auth.status === 503)
    return page(
      503,
      "Admin unavailable",
      "The admin area is not configured or cannot verify sign-ins right now.",
    );
  if (auth.status === 403)
    return page(403, "Not authorized", "This account is not on the admin allowlist.");
  return page(401, "Sign-in required", "Open this page through Cloudflare Access to sign in.");
}

/** Headers added to every admin page that is served. */
export const adminPageHeaders = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;
