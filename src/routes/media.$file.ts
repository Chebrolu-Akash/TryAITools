import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeEnv } from "@/lib/db/env";
import { serveMedia, type MediaReader } from "@/lib/media-serve";

// /media/<uuid>.<ext>: images uploaded in the admin, read straight from R2 (no D1). When a static build is deployed the
// gate answers this path itself with the same function and this route never runs.
export const Route = createFileRoute("/media/$file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const env = await getRuntimeEnv();
        return serveMedia(request, (env["MEDIA"] as MediaReader | undefined) ?? null);
      },
    },
  },
});
