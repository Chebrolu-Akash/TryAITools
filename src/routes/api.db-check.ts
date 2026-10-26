import { createFileRoute } from "@tanstack/react-router";
import { handleDbCheck } from "@/lib/db/check";

// Temporary preview-only diagnostic (see src/lib/db/check.ts). Returns 404 on production hosts.
export const Route = createFileRoute("/api/db-check")({
  server: { handlers: { GET: ({ request }) => handleDbCheck(request) } },
});
