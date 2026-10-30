// TEST HELPER ONLY: generates a real RSA key pair and signs real RS256 JWTs, so tests exercise the
// genuine signature verification path. There is no verification bypass anywhere in application code.
import type { Jwk, JwksProvider } from "@/lib/admin/jwt";

const enc = new TextEncoder();
export const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? enc.encode(b) : new Uint8Array(b);
  let s = "";
  for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const TEAM = "tryaitools-test.cloudflareaccess.com";
export const ISSUER = `https://${TEAM}`;
export const AUD = "a".repeat(64);
export const OWNER = "owner@example.test";

export type TestKey = { kid: string; privateKey: CryptoKey; jwk: Jwk };
export async function makeKey(kid = "key-1"): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as { n: string; e: string };
  return {
    kid,
    privateKey: pair.privateKey,
    jwk: { kty: "RSA", kid, n: pub.n, e: pub.e, alg: "RS256", use: "sig" },
  };
}

export async function signJwt(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT", ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    enc.encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

export const goodClaims = (now: number, over: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: [AUD],
  email: OWNER,
  iat: now - 5,
  nbf: now - 5,
  exp: now + 3600,
  ...over,
});
export const staticJwks = (...keys: TestKey[]): JwksProvider => ({
  async getKey(kid) {
    return keys.find((k) => k.kid === kid)?.jwk ?? null;
  },
});
export const brokenJwks: JwksProvider = {
  async getKey() {
    throw new Error("network down");
  },
};
export const goodEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAILS: OWNER };
