import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeEnv } from "@/lib/db/env";
import { handleStats } from "@/lib/stats";

// The footer's "Visitors" / "Page Views" totals from GA4, for the dev server and deployments without a static build
// (the gate answers this path otherwise). {stats: null} until GA4 read access is configured (see src/lib/stats.ts).
export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async () => handleStats(await getRuntimeEnv()),
    },
  },
});
