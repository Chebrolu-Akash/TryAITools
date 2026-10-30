import { createFileRoute } from "@tanstack/react-router";
import { handleAdminApi } from "@/lib/admin/api";
import type { AdminDb } from "@/lib/admin/db";
import { getD1, getRuntimeEnv } from "@/lib/db/env";

// Every /api/admin/* request, any method, goes through handleAdminApi, which verifies the Cloudflare
// Access JWT and the owner allowlist before doing anything else. No CORS headers are ever sent.
const handle = ({ request }: { request: Request }) =>
  handleAdminApi(request, {
    env: getRuntimeEnv,
    db: async () => (await getD1()).db as AdminDb | null,
  });

export const Route = createFileRoute("/api/admin/$")({
  server: { handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle } },
});
