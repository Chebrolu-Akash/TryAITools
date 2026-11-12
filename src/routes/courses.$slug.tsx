import { createFileRoute } from "@tanstack/react-router";
import { legacyCoursePath } from "@/lib/content/legacy";
import { getD1 } from "@/lib/db/env";

// Old course/book URLs (/courses/<slug>) redirect permanently to their Learning Hub page: /learn/courses/<slug> or
// /learn/books/<slug>, depending on the entry's kind. Unknown or unpublished entries are a 404. With a static build the
// gate answers these itself (same function) and this route never runs.
export const Route = createFileRoute("/courses/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const to = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(params.slug)
          ? await legacyCoursePath((await getD1()).db, params.slug)
          : null;
        return to
          ? new Response(null, {
              status: 301,
              headers: { location: to, "cache-control": "public, max-age=3600" },
            })
          : new Response(
              '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Course not found | TryAITools</title><p>This course is no longer available. <a href="/learn/courses">Browse AI courses</a></p>',
              {
                status: 404,
                headers: {
                  "content-type": "text/html; charset=utf-8",
                  "cache-control": "no-store",
                  "x-robots-tag": "noindex",
                },
              },
            );
      },
    },
  },
});
