// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { captureRuntimeEnv, getRuntimeEnv } from "@/lib/db/env";
// @ts-expect-error plain .mjs helper without types
import * as cfg from "../../scripts/db/wrangler-config.mjs";

const ID = "ef1942a9-2804-440c-95d1-ce50ad70f875";
const MEDIA = { binding: "MEDIA", bucket_name: "tryaitools-media-preview" };
const base = { name: "pixel-perfect", previews: { r2_buckets: [MEDIA] } };
const plan = () =>
  cfg.planPreviewBinding(base, { databaseName: "tryaitools-preview", databaseId: ID });

describe("preview D1 layout (previews.d1_databases, no production binding)", () => {
  it("puts the DB binding under previews and leaves the production top level without D1", () => {
    const p = plan();
    expect(p.config.d1_databases).toBeUndefined();
    expect(p.config.previews.d1_databases).toEqual([
      { binding: "DB", database_name: "tryaitools-preview", database_id: ID },
    ]);
    expect(cfg.validateRepoConfig(p.config, p.migrations).every((r: { ok: boolean }) => r.ok)).toBe(
      true,
    );
  });
  it("moves a legacy top-level preview binding under previews and never touches a non-preview one", () => {
    const legacy = {
      ...base,
      d1_databases: [{ binding: "DB", database_name: "tryaitools-preview", database_id: ID }],
    };
    expect(
      cfg.planPreviewBinding(legacy, { databaseName: "tryaitools-preview", databaseId: ID }).config
        .d1_databases,
    ).toBeUndefined();
    const prodish = {
      ...base,
      d1_databases: [{ binding: "DB", database_name: "tryaitools", database_id: ID }],
    };
    const p = cfg.planPreviewBinding(prodish, {
      databaseName: "tryaitools-preview",
      databaseId: ID,
    });
    expect(p.config.d1_databases).toHaveLength(1);
    expect(p.notes.join(" ")).toMatch(/WARNING/);
    expect(cfg.validateRepoConfig(p.config, p.migrations).some((r: { ok: boolean }) => !r.ok)).toBe(
      true,
    );
  });
  it("refuses production-looking names, bad ids and a different Worker name", () => {
    for (const n of ["tryaitools", "tryaitools-prod", "prod-preview"])
      expect(() => cfg.planPreviewBinding(base, { databaseName: n, databaseId: ID })).toThrow();
    expect(() =>
      cfg.planPreviewBinding(base, { databaseName: "tryaitools-preview", databaseId: "nope" }),
    ).toThrow();
    expect(() =>
      cfg.planPreviewBinding(
        { name: "other" },
        { databaseName: "tryaitools-preview", databaseId: ID },
      ),
    ).toThrow();
  });
  it("migrations config uses PREVIEW_DB, targets the same database and is not deployable", () => {
    const p = plan();
    expect(p.migrations.d1_databases[0]).toMatchObject({ binding: "PREVIEW_DB", database_id: ID });
    expect(p.migrations.name).toBeUndefined();
    expect(p.migrations.main).toBeUndefined();
  });
  it("generated-config check passes only when Nitro kept previews and added no production D1", () => {
    const p = plan();
    const good = { name: "pixel-perfect", previews: p.config.previews };
    expect(cfg.validateGeneratedConfig(good, p.config).every((r: { ok: boolean }) => r.ok)).toBe(
      true,
    );
    expect(
      cfg
        .validateGeneratedConfig({ name: "pixel-perfect" }, p.config)
        .some((r: { ok: boolean }) => !r.ok),
    ).toBe(true);
    expect(
      cfg
        .validateGeneratedConfig(
          { ...good, d1_databases: p.config.previews.d1_databases },
          p.config,
        )
        .some((r: { ok: boolean }) => !r.ok),
    ).toBe(true);
  });
  it("image storage: only a preview R2 bucket, only under previews", () => {
    const p = plan();
    const ok = (c: unknown) =>
      cfg.validateRepoConfig(c, p.migrations).every((r: { ok: boolean }) => r.ok);
    expect(ok(p.config)).toBe(true);
    expect(ok({ ...p.config, r2_buckets: [MEDIA] })).toBe(false); // production binding
    const named = (bucket_name: string) => ({
      ...p.config,
      previews: { ...p.config.previews, r2_buckets: [{ binding: "MEDIA", bucket_name }] },
    });
    expect(ok(named("tryaitools-media"))).toBe(false);
    expect(ok(named("tryaitools-prod-preview"))).toBe(false);
    // no bucket is allowed (image uploads are simply off), and so is a config without the key
    expect(ok({ ...p.config, previews: { ...p.config.previews, r2_buckets: [] } })).toBe(true);
    const { r2_buckets: _r, ...noR2 } = p.config.previews;
    expect(ok({ ...p.config, previews: noR2 })).toBe(true);
    // two MEDIA bindings are not
    expect(
      ok({ ...p.config, previews: { ...p.config.previews, r2_buckets: [MEDIA, MEDIA] } }),
    ).toBe(false);
    const gen = {
      name: "pixel-perfect",
      previews: { d1_databases: p.config.previews.d1_databases },
    };
    expect(cfg.validateGeneratedConfig(gen, p.config).some((r: { ok: boolean }) => !r.ok)).toBe(
      true,
    ); // Nitro dropped the bucket
  });
  it("production binding: only DB -> tryaitools-production, matching its migrations config", () => {
    const p = plan();
    const PROD_ID = "d120a8d7-1450-4d42-b345-5e22ce208dcd";
    const prodMig = {
      d1_databases: [
        { binding: "PRODUCTION_DB", database_name: "tryaitools-production", database_id: PROD_ID },
      ],
    };
    const top = [{ binding: "DB", database_name: "tryaitools-production", database_id: PROD_ID }];
    const ok = (c: unknown, m: unknown = prodMig) =>
      cfg.validateRepoConfig(c, p.migrations, m).every((r: { ok: boolean }) => r.ok);
    expect(ok({ ...p.config, d1_databases: top })).toBe(true);
    // missing, preview database at the top level, extra binding, wrong id
    expect(ok(p.config)).toBe(false);
    expect(ok({ ...p.config, d1_databases: p.config.previews.d1_databases })).toBe(false);
    expect(ok({ ...p.config, d1_databases: [...top, { ...top[0], binding: "DB2" }] })).toBe(false);
    expect(ok({ ...p.config, d1_databases: [{ ...top[0], database_id: ID }] })).toBe(false);
    // a production migrations config that points at the preview database is refused
    const bad = { d1_databases: [{ ...prodMig.d1_databases[0], database_id: ID }] };
    expect(ok({ ...p.config, d1_databases: [{ ...top[0], database_id: ID }] }, bad)).toBe(false);
    // generated config must carry the same top-level binding (and never the preview database)
    const repo = { ...p.config, d1_databases: top };
    const gen = { name: "pixel-perfect", previews: p.config.previews, d1_databases: top };
    expect(cfg.validateGeneratedConfig(gen, repo).every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(
      cfg
        .validateGeneratedConfig({ ...gen, d1_databases: undefined }, repo)
        .some((r: { ok: boolean }) => !r.ok),
    ).toBe(true);
  });
  it("parses JSONC with comments, strings containing // and trailing commas", () => {
    expect(cfg.parseJsonc('{ // c\n "u": "https://x//y", /* b */ "a": [1,], }')).toEqual({
      u: "https://x//y",
      a: [1],
    });
    expect(cfg.hasComments('{"u":"https://x//y"}')).toBe(false);
    expect(cfg.hasComments("{ // c\n}")).toBe(true);
  });
});

describe("preview-d1 command construction", () => {
  const target = cfg.resolveTarget(plan().migrations);
  it("always uses --remote and the migrations config, and never a production target", () => {
    for (const k of ["migrate", "list", "file", "query", "export"]) {
      const a = cfg.wranglerArgs(k, target, { file: "f.sql", sql: "select 1" });
      expect(a).toContain("--remote");
      expect(a[a.indexOf("--config") + 1]).toBe("wrangler.preview-migrations.jsonc");
      expect(a).toContain("PREVIEW_DB");
    }
  });
  it("refuses a non-preview target", () => {
    expect(() =>
      cfg.resolveTarget({
        d1_databases: [{ binding: "PREVIEW_DB", database_name: "tryaitools", database_id: ID }],
      }),
    ).toThrow();
  });
  it("rolls back only the newest applied migration", () => {
    const downs = readdirSync(resolve("db/rollback"));
    expect(cfg.pickRollback(["0001_core.sql", "0002_blog.sql"], downs)).toEqual({
      migration: "0002_blog.sql",
      down: "0002_blog.down.sql",
    });
    expect(() => cfg.pickRollback([], downs)).toThrow();
    expect(() => cfg.pickRollback(["0009_x.sql"], downs)).toThrow();
  });
  it("every migration has a rollback that removes its own d1_migrations row and drops nothing older", () => {
    for (const m of readdirSync(resolve("migrations"))) {
      const down = readFileSync(resolve("db/rollback", m.replace(/\.sql$/, ".down.sql")), "utf8");
      expect(down).toContain(`DELETE FROM d1_migrations WHERE name = '${m}'`);
      expect(down).not.toMatch(/DROP TABLE IF EXISTS d1_migrations/);
    }
  });
});

describe("source safety scans", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)],
    );
  it("admin repository code never relies on SQLite changes() inside a batch", () => {
    for (const f of files(resolve("src/lib/admin")))
      expect(
        readFileSync(f, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, ""),
      ).not.toMatch(/\bchanges\s*\(\)/);
  });
  it("committed wrangler.jsonc binds only the production database at the top level, never the preview one", () => {
    const repo = cfg.parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
    const prod = cfg.parseJsonc(readFileSync(cfg.PRODUCTION_MIGRATIONS_CONFIG_FILE, "utf8"));
    const preview = cfg.parseJsonc(readFileSync(cfg.MIGRATIONS_CONFIG_FILE, "utf8"));
    expect(repo.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "tryaitools-production",
        database_id: prod.d1_databases[0].database_id,
      },
    ]);
    expect(repo.d1_databases[0].database_id).not.toBe(preview.d1_databases[0].database_id);
    expect(
      cfg.validateRepoConfig(repo, preview, prod).every((r: { ok: boolean }) => r.ok),
    ).toBe(true);
  });
});

describe("getRuntimeEnv", () => {
  const keys = { ACCESS_TEAM_DOMAIN: "t", ACCESS_AUD: "a", OWNER_EMAILS: "o@x.com" };
  it("falls through to the cloudflare:workers env when the captured env lacks the Access settings", async () => {
    captureRuntimeEnv({ SOMETHING: 1 });
    expect(await getRuntimeEnv(async () => keys)).toEqual(keys);
  });
  it("prefers a captured env that has them, and returns {} (fail closed) when nobody does", async () => {
    captureRuntimeEnv(keys);
    expect(await getRuntimeEnv(async () => ({ OTHER: 1 }))).toEqual(keys);
    captureRuntimeEnv({});
    expect(await getRuntimeEnv(async () => null)).toEqual({});
  });
});
