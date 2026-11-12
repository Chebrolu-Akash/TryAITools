import { createFileRoute } from "@tanstack/react-router";

// The AI Courses section moved into the AI Learning Hub. /courses keeps working as a permanent redirect (the static gate
// answers it the same way without the app).
export const Route = createFileRoute("/courses/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(null, {
          status: 301,
          headers: {
            location: `/learn/courses${new URL(request.url).search}`,
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
