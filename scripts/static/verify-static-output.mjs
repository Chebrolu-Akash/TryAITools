#!/usr/bin/env node
// Refuses to let anything but the static (gate + pre-rendered) build reach Cloudflare. A plain `vite build` makes the
// full app the Worker entry, so every page view is server-rendered from D1 (thousands of rows per page): that build
// used up most of D1's daily read quota on 2026-11-24. Run right before `wrangler deploy` / `wrangler versions upload`.
//
//   node scripts/static/verify-static-output.mjs [--out .output] [--min-pages 100]
//
// Exit 0 only when every check passes. Reads local files only.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

/** Every check on a build output directory: [{ name, ok, detail }]. */
export function checkStaticOutput(out, { minPages = 100 } = {}) {
  const rows = [];
  const add = (name, ok, detail = "") => rows.push({ name, ok: !!ok, detail });
  const cfg = readJson(join(out, "server/wrangler.json"));
  add("generated Worker config exists", cfg, "server/wrangler.json");
  add("Worker is pixel-perfect", cfg?.name === "pixel-perfect", cfg?.name);
  add("Worker entry is the gate, not the app", cfg?.main === "gate.mjs", cfg?.main);
  const first = cfg?.assets?.run_worker_first;
  add(
    "gate runs first for pages, assets served directly",
    Array.isArray(first) && first[0] === "/*" && first.includes("!/assets/*"),
    JSON.stringify(first)?.slice(0, 60),
  );
  const gate = join(out, "server/gate.mjs");
  const gateCode = existsSync(gate) ? readFileSync(gate, "utf8") : "";
  add(
    "gate bundle present and wired to the app",
    gateCode.includes('"./index.mjs"'),
    "server/gate.mjs",
  );
  const build = readJson(join(out, "public/_static/build.json"));
  add("pre-render manifest present", build, "public/_static/build.json");
  add(
    `at least ${minPages} pre-rendered pages`,
    (build?.pages ?? 0) >= minPages,
    String(build?.pages ?? 0),
  );
  add(
    "built from a D1 snapshot",
    typeof build?.snapshotVersion === "string" && build.snapshotVersion,
    build?.snapshotVersion,
  );
  const files = readJson(join(out, "public/_static/files.json")) ?? [];
  const missing = files.filter((f) => !existsSync(join(out, "public", f)));
  add(
    "every listed page file exists",
    files.length > 0 && missing.length === 0,
    missing.slice(0, 3).join(", "),
  );
  for (const f of [
    "index.html",
    "404.html",
    "sitemap.xml",
    "_static/search.json",
    "_static/sitemap.json",
    "robots.txt",
  ])
    add(`public/${f} present`, existsSync(join(out, "public", f)));
  const sitemap = existsSync(join(out, "public/sitemap.xml"))
    ? readFileSync(join(out, "public/sitemap.xml"), "utf8")
    : "";
  add(
    "sitemap uses only https://tryaitools.io",
    sitemap.includes("<loc>https://tryaitools.io/") &&
      !/<loc>(?!https:\/\/tryaitools\.io[/<])/.test(sitemap),
  );
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const rows = checkStaticOutput(resolve(arg("--out", ".output")), {
    minPages: Number(arg("--min-pages", "100")),
  });
  for (const r of rows)
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
  if (rows.every((r) => r.ok)) console.log("\nSTATIC OUTPUT VERIFIED");
  else {
    console.error(
      "\nREFUSED: .output is not the verified static build. Nothing may be deployed from it.",
    );
    process.exit(1);
  }
}
