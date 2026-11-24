// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Cloudflare Workers Builds sets WORKERS_CI. There, a plain `vite build` would deploy the full app as the Worker entry
// (every page rendered from D1), so it must run inside the static pipeline (scripts/static/ci-build.mjs), which sets
// STATIC_PIPELINE. Failing here means a misconfigured build command deploys nothing.
if (
  process.env["WORKERS_CI"] &&
  process.env["STATIC_PIPELINE"] !== "1" &&
  process.argv.includes("build")
) {
  throw new Error(
    "Refusing a plain `vite build` in Cloudflare Workers Builds: use `bun run build:static` (scripts/static/ci-build.mjs).",
  );
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
