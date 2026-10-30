// Cloudflare Access JWT verification (RS256) using WebCrypto. Nothing in the token is trusted until:
//   1. alg is exactly RS256 (no "none", no HS256 key-confusion)
//   2. the signature verifies against a key from the team's JWKS, selected by `kid`
//   3. iss equals the configured issuer, aud contains a configured Access AUD
//   4. exp is in the future (and nbf/iat are not in the future beyond a small clock skew)
//   5. an `email` claim is present
// A JWKS that cannot be fetched is an error, never a pass.

export type Jwk = { kty: string; kid?: string; n: string; e: string; alg?: string; use?: string };
export type JwksProvider = { getKey(kid: string): Promise<Jwk | null> };

export class AccessJwtError extends Error {
  constructor(
    public code:
      | "malformed"
      | "bad_alg"
      | "unknown_key"
      | "bad_signature"
      | "bad_issuer"
      | "bad_audience"
      | "expired"
      | "not_yet_valid"
      | "no_email"
      | "jwks_unavailable",
  ) {
    super(code);
    this.name = "AccessJwtError";
  }
}

const MAX_TOKEN_LENGTH = 8192;

function b64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new AccessJwtError("malformed");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const parseJson = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch (e) {
    if (e instanceof AccessJwtError) throw e;
  }
  throw new AccessJwtError("malformed");
};

export type VerifyOptions = {
  issuer: string;
  audiences: string[];
  jwks: JwksProvider;
  nowSeconds?: number;
  skewSeconds?: number;
};
export type VerifiedAccessToken = { email: string; claims: Record<string, unknown> };

export async function verifyAccessJwt(
  token: string,
  opts: VerifyOptions,
): Promise<VerifiedAccessToken> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH)
    throw new AccessJwtError("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0))
    throw new AccessJwtError("malformed");
  const [h, p, s] = parts;

  const header = parseJson(h);
  if (header.alg !== "RS256") throw new AccessJwtError("bad_alg");
  if (typeof header.kid !== "string" || !header.kid) throw new AccessJwtError("unknown_key");
  const claims = parseJson(p);

  let jwk: Jwk | null;
  try {
    jwk = await opts.jwks.getKey(header.kid);
  } catch {
    throw new AccessJwtError("jwks_unavailable");
  }
  if (!jwk) throw new AccessJwtError("unknown_key");

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch (e) {
    if (e instanceof AccessJwtError) throw e;
    valid = false;
  }
  if (!valid) throw new AccessJwtError("bad_signature");

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = opts.skewSeconds ?? 60;

  if (claims.iss !== opts.issuer) throw new AccessJwtError("bad_issuer");
  const aud = Array.isArray(claims.aud)
    ? claims.aud
    : typeof claims.aud === "string"
      ? [claims.aud]
      : [];
  if (!aud.some((a) => typeof a === "string" && opts.audiences.includes(a)))
    throw new AccessJwtError("bad_audience");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now)
    throw new AccessJwtError("expired");
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + skew))
    throw new AccessJwtError("not_yet_valid");
  if (claims.iat !== undefined && (typeof claims.iat !== "number" || claims.iat > now + skew))
    throw new AccessJwtError("not_yet_valid");
  if (typeof claims.email !== "string" || !claims.email.includes("@"))
    throw new AccessJwtError("no_email");

  return { email: claims.email.trim().toLowerCase(), claims };
}

/** Fetches and caches the team's signing keys. Unknown `kid` triggers at most one refresh per cooldown. */
export function createJwksProvider(opts: {
  url: string;
  fetchFn?: typeof fetch;
  ttlMs?: number;
  refreshCooldownMs?: number;
  now?: () => number;
}): JwksProvider {
  const fetchFn = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const cooldown = opts.refreshCooldownMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  let keys: Map<string, Jwk> | null = null;
  let fetchedAt = 0;
  let lastForced = 0;

  async function load() {
    const res = await fetchFn(opts.url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("jwks_http_error");
    const text = await res.text();
    if (text.length > 100_000) throw new Error("jwks_too_large");
    const body = JSON.parse(text) as { keys?: Jwk[] };
    const next = new Map<string, Jwk>();
    for (const k of body.keys ?? [])
      if (
        k &&
        k.kty === "RSA" &&
        typeof k.kid === "string" &&
        typeof k.n === "string" &&
        typeof k.e === "string"
      )
        next.set(k.kid, k);
    if (next.size === 0) throw new Error("jwks_empty");
    keys = next;
    fetchedAt = now();
  }

  return {
    async getKey(kid) {
      if (!keys || now() - fetchedAt > ttl) await load();
      let k = keys!.get(kid) ?? null;
      if (!k && now() - lastForced > cooldown) {
        lastForced = now();
        await load();
        k = keys!.get(kid) ?? null;
      }
      return k;
    },
  };
}
