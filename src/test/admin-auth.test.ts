// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticate, checkCsrf, extractAccessToken } from "@/lib/admin/auth";
import { readAdminConfig } from "@/lib/admin/config";
import {
  AccessJwtError,
  createJwksProvider,
  verifyAccessJwt,
  type JwksProvider,
} from "@/lib/admin/jwt";
import {
  AUD,
  brokenJwks,
  goodClaims,
  goodEnv,
  ISSUER,
  makeKey,
  OWNER,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";

afterEach(() => vi.restoreAllMocks());

const NOW = 1_800_000_000;
const opts = (jwks: ReturnType<typeof staticJwks>, over: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  audiences: [AUD],
  jwks,
  nowSeconds: NOW,
  ...over,
});
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no_error";
  } catch (e) {
    return e instanceof AccessJwtError ? e.code : `other:${(e as Error).message}`;
  }
};

describe("verifyAccessJwt", () => {
  let key!: TestKey;
  let other!: TestKey; // same kid, different key pair
  let jwks!: JwksProvider;
  beforeAll(async () => {
    key = await makeKey("k1");
    other = await makeKey("k1");
    jwks = staticJwks(key);
  });

  it("accepts a correctly signed, current token and normalizes the email", async () => {
    const t = await signJwt(key, goodClaims(NOW, { email: "Owner@Example.Test" }));
    expect((await verifyAccessJwt(t, opts(jwks))).email).toBe("owner@example.test");
  });
  it("accepts aud as a string and as an array containing the configured AUD", async () => {
    expect(
      await codeOf(verifyAccessJwt(await signJwt(key, goodClaims(NOW, { aud: AUD })), opts(jwks))),
    ).toBe("no_error");
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { aud: ["zzz", AUD] })), opts(jwks)),
      ),
    ).toBe("no_error");
  });
  it("rejects a token signed by a different key (bad signature)", async () => {
    expect(await codeOf(verifyAccessJwt(await signJwt(other, goodClaims(NOW)), opts(jwks)))).toBe(
      "bad_signature",
    );
  });
  it("rejects a tampered payload", async () => {
    const t = await signJwt(key, goodClaims(NOW));
    const [h, , s] = t.split(".");
    const forged = btoa(JSON.stringify(goodClaims(NOW, { email: "attacker@evil.test" }))).replace(
      /=+$/,
      "",
    );
    expect(await codeOf(verifyAccessJwt(`${h}.${forged}.${s}`, opts(jwks)))).toBe("bad_signature");
  });
  it("rejects alg none and HS256 (algorithm confusion)", async () => {
    for (const alg of ["none", "HS256", "RS512"]) {
      const t = await signJwt(key, goodClaims(NOW), { alg });
      expect(await codeOf(verifyAccessJwt(t, opts(jwks)))).toBe("bad_alg");
    }
  });
  it("rejects the wrong issuer", async () => {
    expect(
      await codeOf(
        verifyAccessJwt(
          await signJwt(key, goodClaims(NOW, { iss: "https://evil.cloudflareaccess.com" })),
          opts(jwks),
        ),
      ),
    ).toBe("bad_issuer");
  });
  it("rejects the wrong audience", async () => {
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { aud: ["b".repeat(64)] })), opts(jwks)),
      ),
    ).toBe("bad_audience");
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { aud: undefined })), opts(jwks)),
      ),
    ).toBe("bad_audience");
  });
  it("rejects an expired token, including exp exactly now", async () => {
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { exp: NOW - 1 })), opts(jwks)),
      ),
    ).toBe("expired");
    expect(
      await codeOf(verifyAccessJwt(await signJwt(key, goodClaims(NOW, { exp: NOW })), opts(jwks))),
    ).toBe("expired");
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { exp: undefined })), opts(jwks)),
      ),
    ).toBe("expired");
  });
  it("rejects tokens that are not valid yet (nbf / iat in the future beyond skew)", async () => {
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { nbf: NOW + 600 })), opts(jwks)),
      ),
    ).toBe("not_yet_valid");
    expect(
      await codeOf(
        verifyAccessJwt(await signJwt(key, goodClaims(NOW, { iat: NOW + 600 })), opts(jwks)),
      ),
    ).toBe("not_yet_valid");
  });
  it("rejects tokens without an email (e.g. service tokens)", async () => {
    expect(
      await codeOf(
        verifyAccessJwt(
          await signJwt(key, goodClaims(NOW, { email: undefined, common_name: "svc" })),
          opts(jwks),
        ),
      ),
    ).toBe("no_email");
  });
  it("rejects an unknown kid", async () => {
    const stranger = await makeKey("not-in-jwks");
    expect(
      await codeOf(verifyAccessJwt(await signJwt(stranger, goodClaims(NOW)), opts(jwks))),
    ).toBe("unknown_key");
  });
  it("rejects malformed tokens", async () => {
    for (const t of ["", "abc", "a.b", "a.b.c.d", "...", "!!!.@@@.###", "x".repeat(9000)])
      expect(await codeOf(verifyAccessJwt(t, opts(jwks)))).toBe("malformed");
  });
  it("treats an unreachable JWKS as an error, never as success", async () => {
    expect(
      await codeOf(verifyAccessJwt(await signJwt(key, goodClaims(NOW)), opts(brokenJwks))),
    ).toBe("jwks_unavailable");
  });
});

describe("createJwksProvider", () => {
  let key!: TestKey;
  beforeAll(async () => {
    key = await makeKey("k1");
  });
  const mk = (fetchFn: typeof fetch, t = { v: 0 }) => ({
    provider: createJwksProvider({
      url: "https://x/certs",
      fetchFn,
      ttlMs: 1000,
      refreshCooldownMs: 500,
      now: () => t.v,
    }),
    t,
  });
  const ok = (keys: unknown[]) => async () =>
    new Response(JSON.stringify({ keys }), { status: 200 });

  it("caches keys within the TTL and refetches after it", async () => {
    let calls = 0;
    const { provider, t } = mk(
      (async () => (calls++, await ok([key.jwk])())) as unknown as typeof fetch,
    );
    await provider.getKey("k1");
    await provider.getKey("k1");
    expect(calls).toBe(1);
    t.v = 2000;
    await provider.getKey("k1");
    expect(calls).toBe(2);
  });
  it("refreshes once for an unknown kid, then respects the cooldown", async () => {
    let calls = 0;
    const { provider, t } = mk(
      (async () => (calls++, await ok([key.jwk])())) as unknown as typeof fetch,
    );
    await provider.getKey("k1");
    t.v = 600;
    expect(await provider.getKey("nope")).toBeNull();
    expect(calls).toBe(2);
    expect(await provider.getKey("nope")).toBeNull();
    expect(calls).toBe(2);
  });
  it("throws on HTTP errors and on empty or invalid key sets", async () => {
    await expect(
      mk(
        (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
      ).provider.getKey("k1"),
    ).rejects.toBeTruthy();
    await expect(mk(ok([]) as unknown as typeof fetch).provider.getKey("k1")).rejects.toBeTruthy();
    await expect(
      mk(ok([{ kty: "oct", kid: "k1" }]) as unknown as typeof fetch).provider.getKey("k1"),
    ).rejects.toBeTruthy();
  });
});

describe("readAdminConfig", () => {
  it("accepts a complete configuration", () => {
    const r = readAdminConfig(goodEnv);
    expect(r.ok && r.config.issuer).toBe(ISSUER);
    expect(r.ok && r.config.owners).toEqual([OWNER]);
  });
  it("fails closed and names only the missing settings, never their values", () => {
    expect(readAdminConfig({})).toEqual({
      ok: false,
      missing: ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "OWNER_EMAILS"],
    });
    expect(readAdminConfig({ ...goodEnv, OWNER_EMAILS: "" })).toEqual({
      ok: false,
      missing: ["OWNER_EMAILS"],
    });
    expect(readAdminConfig({ ...goodEnv, OWNER_EMAILS: "not-an-email" })).toEqual({
      ok: false,
      missing: ["OWNER_EMAILS"],
    });
    expect(readAdminConfig({ ...goodEnv, ACCESS_TEAM_DOMAIN: "evil.example.com" })).toEqual({
      ok: false,
      missing: ["ACCESS_TEAM_DOMAIN"],
    });
    expect(readAdminConfig({ ...goodEnv, ACCESS_AUD: "short" })).toEqual({
      ok: false,
      missing: ["ACCESS_AUD"],
    });
  });
  it("accepts several owners and AUDs, lower-casing emails", () => {
    const r = readAdminConfig({
      ...goodEnv,
      OWNER_EMAILS: "A@x.test, b@y.test",
      ACCESS_AUD: `${AUD},${"c".repeat(64)}`,
    });
    expect(r.ok && r.config.owners).toEqual(["a@x.test", "b@y.test"]);
    expect(r.ok && r.config.audiences.length).toBe(2);
  });
});

describe("authenticate", () => {
  let key!: TestKey;
  let jwks!: JwksProvider;
  let deps!: { jwks: JwksProvider; nowSeconds: number };
  beforeAll(async () => {
    key = await makeKey("k1");
    jwks = staticJwks(key);
    deps = { jwks, nowSeconds: NOW };
  });
  const req = (headers: Record<string, string> = {}) =>
    new Request("https://admin.test/api/admin/session", { headers });

  it("401 without a token", async () => {
    expect(await authenticate(req(), goodEnv, deps)).toEqual({
      ok: false,
      status: 401,
      code: "unauthenticated",
    });
  });
  it("ignores spoofable identity headers: an email header without a JWT is still 401", async () => {
    const r = await authenticate(
      req({
        "cf-access-authenticated-user-email": OWNER,
        "x-forwarded-email": OWNER,
        "x-user-email": OWNER,
      }),
      goodEnv,
      deps,
    );
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
  it("401 for a forged or invalid token", async () => {
    const forged = await signJwt(await makeKey("k1"), goodClaims(NOW));
    expect(
      await authenticate(req({ "cf-access-jwt-assertion": forged }), goodEnv, deps),
    ).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
    expect(
      await authenticate(req({ "cf-access-jwt-assertion": "garbage" }), goodEnv, deps),
    ).toMatchObject({ ok: false, status: 401 });
  });
  it("403 for a valid token whose email is not on the owner allowlist", async () => {
    const t = await signJwt(key, goodClaims(NOW, { email: "stranger@example.test" }));
    expect(await authenticate(req({ "cf-access-jwt-assertion": t }), goodEnv, deps)).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
    });
  });
  it("200-equivalent for an allowlisted owner, via header or CF_Authorization cookie", async () => {
    const t = await signJwt(key, goodClaims(NOW));
    expect(await authenticate(req({ "cf-access-jwt-assertion": t }), goodEnv, deps)).toEqual({
      ok: true,
      email: OWNER,
      mode: "access",
    });
    expect(
      await authenticate(req({ cookie: `a=1; CF_Authorization=${t}; b=2` }), goodEnv, deps),
    ).toEqual({ ok: true, email: OWNER, mode: "access" });
  });

  describe("local development sign-in", () => {
    const local = (url: string, headers: Record<string, string> = {}) =>
      new Request(url, { headers });
    const devEnv = { OWNER_EMAILS: OWNER, ADMIN_LOCAL_DEV_EMAIL: OWNER };
    beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));

    it("signs in the configured owner on localhost, 127.0.0.1 and [::1] without Access settings", async () => {
      for (const host of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"])
        expect(await authenticate(local(`${host}/api/admin/session`), devEnv, deps)).toEqual({
          ok: true,
          email: OWNER,
          mode: "local-dev",
        });
    });
    it("is ignored on any non-local hostname, so a real deployment still requires Access", async () => {
      for (const url of [
        "https://admin.test/api/admin/session",
        "https://pixel-perfect.example.workers.dev/api/admin/session",
        "https://localhost.evil.test/api/admin/session",
        "https://tryaitools.io/admin",
      ])
        expect(await authenticate(local(url), { ...goodEnv, ...devEnv }, deps)).toMatchObject({
          ok: false,
          status: 401,
        });
    });
    it("is ignored for a request that came through Cloudflare's edge (Cf-Ray present)", async () => {
      const r = local("http://localhost/api/admin/session", { "cf-ray": "8f00000000000000-LHR" });
      expect(await authenticate(r, { ...goodEnv, ...devEnv }, deps)).toMatchObject({
        ok: false,
        status: 401,
      });
    });
    it("still enforces the owner allowlist and fails closed without one", async () => {
      const r = local("http://localhost/api/admin/session");
      expect(
        await authenticate(r, { OWNER_EMAILS: OWNER, ADMIN_LOCAL_DEV_EMAIL: "x@y.test" }, deps),
      ).toEqual({ ok: false, status: 403, code: "forbidden" });
      expect(await authenticate(r, { ADMIN_LOCAL_DEV_EMAIL: OWNER }, deps)).toEqual({
        ok: false,
        status: 503,
        code: "admin_not_configured",
      });
    });
    it("does nothing when the variable is unset or blank", async () => {
      const r = local("http://localhost/api/admin/session");
      expect(
        await authenticate(r, { OWNER_EMAILS: OWNER, ADMIN_LOCAL_DEV_EMAIL: "  " }, deps),
      ).toMatchObject({ ok: false, status: 503 });
      expect(await authenticate(r, goodEnv, deps)).toMatchObject({ ok: false, status: 401 });
    });
  });
  it("owner match is case-insensitive", async () => {
    const t = await signJwt(key, goodClaims(NOW, { email: "OWNER@EXAMPLE.TEST" }));
    expect((await authenticate(req({ "cf-access-jwt-assertion": t }), goodEnv, deps)).ok).toBe(
      true,
    );
  });
  it("503 (fail closed) when configuration is missing, even for a valid token", async () => {
    const t = await signJwt(key, goodClaims(NOW));
    for (const env of [
      {},
      { ...goodEnv, OWNER_EMAILS: "" },
      { ...goodEnv, ACCESS_AUD: undefined },
    ]) {
      expect(await authenticate(req({ "cf-access-jwt-assertion": t }), env, deps)).toMatchObject({
        ok: false,
        status: 503,
        code: "admin_not_configured",
      });
    }
  });
  it("503 (fail closed) when the signing keys cannot be fetched", async () => {
    const t = await signJwt(key, goodClaims(NOW));
    expect(
      await authenticate(req({ "cf-access-jwt-assertion": t }), goodEnv, {
        jwks: brokenJwks,
        nowSeconds: NOW,
      }),
    ).toMatchObject({ ok: false, status: 503, code: "auth_unavailable" });
  });
  it("extractAccessToken reads only the Access header or cookie", () => {
    expect(extractAccessToken(req({ authorization: "Bearer x", "x-token": "y" }))).toBeNull();
    expect(extractAccessToken(req({ "cf-access-jwt-assertion": " abc " }))).toBe("abc");
  });
});

describe("checkCsrf", () => {
  const post = (h: Record<string, string>) =>
    new Request("https://admin.test/api/admin/tools", { method: "POST", headers: h });
  const good = {
    "x-requested-with": "tryaitools-admin",
    origin: "https://admin.test",
    "content-type": "application/json",
  };
  it("allows safe methods without extra headers", () =>
    expect(checkCsrf(new Request("https://admin.test/api/admin/tools")).ok).toBe(true));
  it("accepts a same-origin JSON request with the custom header", () =>
    expect(checkCsrf(post(good)).ok).toBe(true));
  it("rejects a missing custom header", () =>
    expect(checkCsrf(post({ ...good, "x-requested-with": "" }))).toMatchObject({
      ok: false,
      status: 403,
    }));
  it("rejects a cross-origin Origin", () =>
    expect(checkCsrf(post({ ...good, origin: "https://evil.test" }))).toMatchObject({
      ok: false,
      status: 403,
    }));
  it("rejects when Origin is absent and Sec-Fetch-Site is not same-origin; accepts when it is", () => {
    const { origin: _o, ...noOrigin } = good;
    expect(checkCsrf(post({ ...noOrigin, "sec-fetch-site": "cross-site" }))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkCsrf(post({ ...noOrigin, "sec-fetch-site": "same-origin" })).ok).toBe(true);
  });
  it("rejects non-JSON content types (form posts)", () => {
    expect(
      checkCsrf(post({ ...good, "content-type": "application/x-www-form-urlencoded" })),
    ).toMatchObject({ ok: false, status: 415 });
    expect(checkCsrf(post({ ...good, "content-type": "text/plain" }))).toMatchObject({
      ok: false,
      status: 415,
    });
  });
});
