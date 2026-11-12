// Footer statistics ("Visitors", "Page Views") from the site's existing Google Analytics 4 property, read server-side
// through the GA4 Data API. Nothing is written per page view: GA4 already counts page views (src/lib/analytics.ts sends
// one page_view per page load or client navigation, none for /admin) and filters known bots itself.
//
// Off until configured. Reading GA4 needs a Google Cloud service account with Viewer access to the property; without
// all three settings below, /api/stats answers {stats: null} and the footer shows nothing (no placeholder numbers):
//   GA4_PROPERTY_ID          numeric property ID (Admin > Property details), e.g. 123456789; NOT the G-... measurement ID
//   GA4_CLIENT_EMAIL         the service account's client_email                        (Worker secret)
//   GA4_PRIVATE_KEY          the service account's private_key, PEM (PKCS#8)            (Worker secret)
//   GA4_STATS_START_DATE     optional, YYYY-MM-DD; totals are counted from this date (default: all available data)
//
// Visitors = GA4 totalUsers, Page Views = GA4 screenPageViews, both over [start date, today].
// Cost: one token request + one runReport per CACHE_MS per isolate at most, also shared through the Cache API when it is
// available. The credentials never leave the Worker; the response holds only the two numbers.
// No runtime imports: the static gate bundles this file as well as the app.

export const STATS_PATH = "/api/stats";
export const CACHE_MS = 60 * 60_000;
/** After a failure, wait this long before asking GA again (keeps the last good totals meanwhile). */
export const RETRY_MS = 10 * 60_000;
const EARLIEST = "2015-08-14"; // the earliest date the GA4 Data API accepts
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const SHARED_CACHE_KEY = "https://stats.internal/ga4-totals";

export type SiteStats = { visitors: number; views: number; since: string };
export type Ga4Config = {
  propertyId: string;
  clientEmail: string;
  privateKey: string;
  startDate: string;
};
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The GA4 settings, or null when any required one is missing or malformed (statistics stay off). */
export function ga4Config(env: Record<string, unknown>): Ga4Config | null {
  const s = (k: string) => (typeof env[k] === "string" ? (env[k] as string).trim() : "");
  const propertyId = s("GA4_PROPERTY_ID");
  const clientEmail = s("GA4_CLIENT_EMAIL");
  // Secrets pasted from the JSON key file often keep literal "\n" sequences.
  const privateKey = s("GA4_PRIVATE_KEY").replace(/\\n/g, "\n");
  const start = s("GA4_STATS_START_DATE");
  if (!/^\d{1,20}$/.test(propertyId)) return null;
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) return null;
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) return null;
  return {
    propertyId,
    clientEmail,
    privateKey,
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(start) && start >= EARLIEST ? start : EARLIEST,
  };
}

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A signed service-account assertion (RS256), exchanged for a short-lived read-only access token. */
export async function serviceAccountJwt(cfg: Ga4Config, nowSeconds: number) {
  const pem = cfg.privateKey.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 600,
    }),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(sig)}`;
}

/** Asks GA4 for the totals. Throws on any error (callers keep the last good value). */
export async function fetchGa4Totals(
  cfg: Ga4Config,
  fetchFn: Fetch,
  nowMs: number,
): Promise<SiteStats> {
  const assertion = await serviceAccountJwt(cfg, Math.floor(nowMs / 1000));
  const tokenRes = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`GA4 token request failed (${tokenRes.status})`);
  const { access_token: token } = (await tokenRes.json()) as { access_token?: string };
  if (!token) throw new Error("GA4 token response had no access_token");
  const reportRes = await fetchFn(
    `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: cfg.startDate, endDate: "today" }],
        metrics: [{ name: "totalUsers" }, { name: "screenPageViews" }],
      }),
    },
  );
  if (!reportRes.ok) throw new Error(`GA4 runReport failed (${reportRes.status})`);
  const report = (await reportRes.json()) as {
    rows?: { metricValues?: { value?: string }[] }[];
  };
  const v = report.rows?.[0]?.metricValues ?? [];
  const visitors = Number(v[0]?.value ?? 0);
  const views = Number(v[1]?.value ?? 0);
  if (!Number.isFinite(visitors) || !Number.isFinite(views))
    throw new Error("GA4 report malformed");
  return { visitors, views, since: cfg.startDate };
}

let cached: { at: number; value: SiteStats | null; ok: boolean } | null = null;
let pending: Promise<SiteStats | null> | null = null;
/** Test hook. */
export const resetStatsCache = () => {
  cached = null;
  pending = null;
};

type SharedCache = {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
};
const sharedCache = (): SharedCache | null =>
  (globalThis as { caches?: { default?: SharedCache } }).caches?.default ?? null;

/** The totals for the footer, or null when statistics are not configured, not available yet, or zero. */
export async function readStats(
  env: Record<string, unknown>,
  opts: { fetch?: Fetch; nowMs?: number; shared?: SharedCache | null } = {},
): Promise<SiteStats | null> {
  const cfg = ga4Config(env);
  if (!cfg) return null; // not configured: off
  const now = opts.nowMs ?? Date.now();
  if (cached && now - cached.at < (cached.ok ? CACHE_MS : RETRY_MS)) return cached.value;
  if (pending) return pending; // one request to GA at a time per isolate
  const shared = opts.shared === undefined ? sharedCache() : opts.shared;
  pending = (async () => {
    try {
      const hit = await shared?.match(new Request(SHARED_CACHE_KEY)).catch(() => undefined);
      if (hit) {
        const value = (await hit.json()) as SiteStats | null;
        cached = { at: now, value, ok: true };
        return value;
      }
      const totals = await fetchGa4Totals(cfg, opts.fetch ?? ((i, init) => fetch(i, init)), now);
      const value = totals.views > 0 ? totals : null;
      cached = { at: now, value, ok: true };
      await shared
        ?.put(
          new Request(SHARED_CACHE_KEY),
          new Response(JSON.stringify(value), {
            headers: { "cache-control": `max-age=${CACHE_MS / 1000}` },
          }),
        )
        .catch(() => {});
      return value;
    } catch (e) {
      console.error("stats: GA4 read failed", e instanceof Error ? e.message : e);
      const value = cached?.value ?? null; // keep the last good totals
      cached = { at: now, value, ok: false };
      return value;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** GET /api/stats: the two totals (never the configuration), cacheable by browsers for a while. */
export async function handleStats(env: Record<string, unknown>) {
  const stats = await readStats(env);
  return new Response(JSON.stringify({ stats }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": stats ? "public, max-age=900" : "public, max-age=300",
      "x-robots-tag": "noindex",
    },
  });
}
