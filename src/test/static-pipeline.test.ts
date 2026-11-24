// The Workers Builds pipeline may only ever ship the static (gate + pre-rendered) build: a plain `vite build` once
// deployed the full app and used most of D1's daily read quota (2026-11-24).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build scripts
import { resolveTarget } from "../../scripts/static/ci-build.mjs";
// @ts-expect-error plain .mjs build scripts
import { checkStaticOutput } from "../../scripts/static/verify-static-output.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function output(kind: "dynamic" | "static") {
  const out = mkdtempSync(join(tmpdir(), "static-out-"));
  dirs.push(out);
  mkdirSync(join(out, "server"), { recursive: true });
  mkdirSync(join(out, "public/_static"), { recursive: true });
  writeFileSync(join(out, "server/index.mjs"), "export default {}");
  writeFileSync(join(out, "public/robots.txt"), "User-agent: *");
  if (kind === "dynamic") {
    // what a plain `vite build` leaves: the app is the Worker entry, nothing pre-rendered
    writeFileSync(
      join(out, "server/wrangler.json"),
      JSON.stringify({ name: "pixel-perfect", main: "index.mjs" }),
    );
    return out;
  }
  writeFileSync(
    join(out, "server/wrangler.json"),
    JSON.stringify({
      name: "pixel-perfect",
      main: "gate.mjs",
      assets: { run_worker_first: ["/*", "!/assets/*"] },
    }),
  );
  writeFileSync(join(out, "server/gate.mjs"), 'import a from "./index.mjs";');
  const files = [
    "index.html",
    "404.html",
    "sitemap.xml",
    ...Array.from({ length: 3 }, (_, i) => `tools/t${i}.html`),
  ];
  mkdirSync(join(out, "public/tools"), { recursive: true });
  for (const f of files)
    writeFileSync(
      join(out, "public", f),
      f === "sitemap.xml"
        ? "<urlset><url><loc>https://tryaitools.io/</loc></url></urlset>"
        : "<html></html>",
    );
  writeFileSync(join(out, "public/_static/files.json"), JSON.stringify(files));
  writeFileSync(join(out, "public/_static/search.json"), "[]");
  writeFileSync(join(out, "public/_static/sitemap.json"), "{}");
  writeFileSync(
    join(out, "public/_static/build.json"),
    JSON.stringify({ pages: files.length, snapshotVersion: "v1#test" }),
  );
  return out;
}
const failed = (rows: { name: string; ok: boolean }[]) =>
  rows.filter((r) => !r.ok).map((r) => r.name);

describe("static release pipeline", () => {
  it("refuses a plain vite build (app as Worker entry, nothing pre-rendered)", () => {
    const rows = checkStaticOutput(output("dynamic"), { minPages: 1 });
    expect(failed(rows)).toEqual(
      expect.arrayContaining([
        "Worker entry is the gate, not the app",
        "pre-render manifest present",
      ]),
    );
  });

  it("accepts the gate + pre-rendered build", () => {
    expect(failed(checkStaticOutput(output("static"), { minPages: 1 }))).toEqual([]);
  });

  it("refuses a build with too few pages or a foreign sitemap host", () => {
    const out = output("static");
    expect(failed(checkStaticOutput(out, { minPages: 100 }))).toEqual([
      "at least 100 pre-rendered pages",
    ]);
    writeFileSync(join(out, "public/sitemap.xml"), "<loc>https://x.workers.dev/</loc>");
    expect(failed(checkStaticOutput(out, { minPages: 1 }))).toEqual([
      "sitemap uses only https://tryaitools.io",
    ]);
  });

  it("builds production data only from main in Workers Builds", () => {
    expect(resolveTarget({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" })).toEqual({
      target: "production",
    });
    expect(resolveTarget({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature/x" })).toEqual({
      target: "preview",
    });
    expect(
      resolveTarget({
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "feature/x",
        STATIC_TARGET: "production",
      }).error,
    ).toMatch(/only be built from main/);
    expect(resolveTarget({ WORKERS_CI: "1" }).error).toBeTruthy();
    expect(resolveTarget({}).error).toBeTruthy();
    expect(resolveTarget({ STATIC_TARGET: "preview" })).toEqual({ target: "preview" });
  });
});
