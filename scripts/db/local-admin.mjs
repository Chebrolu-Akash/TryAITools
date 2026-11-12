#!/usr/bin/env bun
// LOCAL ONLY: runs the built Worker (pixel-perfect) with `wrangler dev` against a SQLite D1 database on this machine,
// so the admin can be used without Cloudflare. Nothing here contacts Cloudflare: every Wrangler call has --local,
// remote bindings are disabled, and the generated config names a local-only database with no real database_id.
//   bun run build                                   (first, and after code changes)
//   bun scripts/db/local-admin.mjs setup            apply migrations + import tools.json into the LOCAL database
//   bun scripts/db/local-admin.mjs start            serve http://127.0.0.1:8787/admin
//   bun scripts/db/local-admin.mjs reset --confirm  delete the local database state (.wrangler/state-admin)
// Sign-in: .dev.vars (git-ignored) must set OWNER_EMAILS and ADMIN_LOCAL_DEV_EMAIL; see .dev.vars.example.
// Uses Wrangler (--local) for migrations/import and Miniflare to serve, both bundled with Wrangler; no Node needed.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const GENERATED = resolve(".output/server/wrangler.json");
const LOCAL_CONFIG = resolve(".output/server/wrangler.local.json"); // inside .output, which is git-ignored
const PERSIST = resolve(".wrangler/state-admin"); // inside .wrangler, which is git-ignored
const DEV_VARS = resolve(".dev.vars");
const PORT = /^\d{2,5}$/.test(process.env.PORT ?? "") ? process.env.PORT : "8787";

const [cmd, ...rest] = process.argv.slice(2);
const die = (msg, code = 2) => {
  console.error(msg);
  process.exit(code);
};

function writeLocalConfig() {
  if (!existsSync(GENERATED)) die("No build output found. Run: bun run build");
  const gen = JSON.parse(readFileSync(GENERATED, "utf8"));
  if (gen.name !== "pixel-perfect") die(`Unexpected Worker name "${gen.name}"; refusing.`);
  const local = { ...gen };
  delete local.previews; // the preview database binding is never used locally
  delete local.routes;
  delete local.route;
  // Nitro stamps today's date, which the bundled local runtime may not know yet. A week earlier is safe locally;
  // the deployed config is not affected.
  const d = new Date(`${gen.compatibility_date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  local.compatibility_date = d.toISOString().slice(0, 10);
  local.d1_databases = [
    {
      binding: "DB",
      database_name: "tryaitools-local",
      database_id: "tryaitools-local", // not a Cloudflare id: Wrangler only uses it to name the local SQLite file
      migrations_dir: "../../migrations",
    },
  ];
  writeFileSync(LOCAL_CONFIG, JSON.stringify(local, null, 2) + "\n");
}

const wrangler = (args, opts = {}) => {
  if (args.includes("--remote")) die("Refusing: this script never runs remote commands.");
  const r = spawnSync(
    process.platform === "win32" ? "bunx.exe" : "bunx",
    ["wrangler", ...args, "--local", "--config", LOCAL_CONFIG, "--persist-to", PERSIST],
    {
      stdio: opts.capture ? "pipe" : "inherit",
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    },
  );
  if (r.status !== 0)
    die(opts.capture ? `${r.stdout}\n${r.stderr}` : "wrangler failed", r.status ?? 1);
  return r.stdout;
};

function readDevVars() {
  if (!existsSync(DEV_VARS))
    die(
      "Missing .dev.vars. Copy .dev.vars.example to .dev.vars and set OWNER_EMAILS and ADMIN_LOCAL_DEV_EMAIL.",
    );
  const vars = Object.fromEntries(
    readFileSync(DEV_VARS, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const owners = (vars.OWNER_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim());
  const dev = (vars.ADMIN_LOCAL_DEV_EMAIL ?? "").trim().toLowerCase();
  if (!dev || !owners.includes(dev))
    die("In .dev.vars, ADMIN_LOCAL_DEV_EMAIL must be set and must also appear in OWNER_EMAILS.");
  return vars;
}

if (cmd === "setup") {
  writeLocalConfig();
  console.log("Applying migrations to the LOCAL database…");
  wrangler(["d1", "migrations", "apply", "DB"]);
  const has = JSON.parse(
    wrangler(["d1", "execute", "DB", "--json", "--command", "SELECT count(*) AS n FROM tools"], {
      capture: true,
    }),
  )[0].results[0].n;
  if (has > 0) {
    console.log(
      `The local database already has ${has} tools; import skipped (use reset to start over).`,
    );
  } else {
    const b = spawnSync(process.execPath, ["scripts/db/build-import.mjs", "--env", "local"], {
      stdio: "inherit",
    });
    if (b.status !== 0) die("build-import failed", b.status ?? 1);
    const report = JSON.parse(readFileSync(resolve("db/import/out/report.json"), "utf8"));
    if (report.env !== "local")
      die(`Generated import is for env="${report.env}", expected "local".`);
    for (const f of report.generatedFiles) {
      console.log(`importing ${f}`);
      wrangler(["d1", "execute", "DB", "--file", resolve("db/import/out", f)], { capture: true });
    }
  }
  console.log("Local database ready. Next: bun scripts/db/local-admin.mjs start");
} else if (cmd === "start") {
  // Miniflare directly (the local runtime Wrangler itself uses), because `wrangler dev` cannot proxy requests when
  // it runs under Bun. The browser talks straight to workerd on 127.0.0.1. Same build output, same local D1 files.
  const vars = readDevVars();
  writeLocalConfig();
  const cfg = JSON.parse(readFileSync(LOCAL_CONFIG, "utf8"));
  const { Miniflare, Log, LogLevel } = await import("miniflare");
  const serverDir = resolve(".output/server");
  const modules = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name))
        modules[relative(serverDir, p).split(sep).join("/")] = {
          type: "esm",
          contents: readFileSync(p, "utf8"),
        };
    }
  };
  walk(serverDir);
  const env = {
    DB: { type: "d1", name: "tryaitools-local", id: "tryaitools-local" },
    ASSETS: { type: "assets" },
    // Uploaded images: a local Miniflare bucket persisted next to the local database (never a remote bucket).
    MEDIA: { type: "r2", name: "tryaitools-media-local" },
  };
  for (const k of [
    "OWNER_EMAILS",
    "ADMIN_LOCAL_DEV_EMAIL",
    "ACCESS_TEAM_DOMAIN",
    "ACCESS_AUD",
    // AI News (optional): without the key, news is collected but not summarised.
    "GEMINI_API_KEY",
    "NEWS_MODEL",
    "NEWS_MAX_SOURCES_PER_RUN",
    "NEWS_MAX_SUMMARIES_PER_RUN",
  ])
    if (vars[k]) env[k] = { type: "text", value: vars[k] };
  const mf = new Miniflare({
    host: "127.0.0.1",
    port: Number(PORT),
    log: new Log(LogLevel.INFO),
    // Lets http://127.0.0.1:8787/cdn-cgi/local/scheduled run the AI News cron locally (Miniflare only).
    unsafeTriggerHandlers: true,
    resourcePersistencePath: resolve(PERSIST, "v3"), // the layout `wrangler d1 ... --persist-to` writes
    workers: [
      {
        config: {
          name: cfg.name,
          compatibilityDate: cfg.compatibility_date,
          compatibilityFlags: cfg.compatibility_flags ?? [],
          manifest: { mainModule: cfg.main, modulesRoot: serverDir, modules },
          env,
          assets: {
            directory: resolve(".output/public"),
            hasUserWorker: true,
            // Mirrors the deployed config: with a static build the gate (main = gate.mjs) runs first for page routes.
            ...(cfg.assets?.run_worker_first
              ? { runWorkerFirst: cfg.assets.run_worker_first }
              : {}),
          },
        },
      },
    ],
  });
  const url = await mf.ready;
  console.log(
    `Local admin ready: ${new URL("/admin", url)}  (signed in as ${vars.ADMIN_LOCAL_DEV_EMAIL}; local only)`,
  );
  const stop = async () => {
    await mf.dispose();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else if (cmd === "reset") {
  if (!rest.includes("--confirm"))
    die("Deletes ALL local admin data. Re-run with: reset --confirm");
  rmSync(PERSIST, { recursive: true, force: true });
  console.log(`Removed ${PERSIST}. Run setup again.`);
} else {
  die("Usage: bun scripts/db/local-admin.mjs setup | start | reset --confirm");
}
