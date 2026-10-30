import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AdminApp, type AdminSearch } from "@/components/admin/AdminApp";
import { pageHead } from "@/lib/seo";

// The admin shell. Access is enforced on the server (src/server.ts -> guardAdminPage) before this page is
// served, and again by every /api/admin call. Nothing here is trusted for authorization.
const VIEWS = ["tools", "categories", "blog"] as const;
const slugLike = (v: unknown) =>
  typeof v === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && v.length <= 80 ? v : undefined;

export const Route = createFileRoute("/admin")({
  validateSearch: (s: Record<string, unknown>): AdminSearch => ({
    view: (VIEWS as readonly unknown[]).includes(s.view)
      ? (s.view as AdminSearch["view"])
      : undefined,
    slug: slugLike(s.slug),
    new: s.new === "1" || s.new === 1 ? "1" : undefined,
    status: ["draft", "review", "published", "archived"].includes(String(s.status))
      ? String(s.status)
      : undefined,
    review: s.review === "1" || s.review === 1 ? "1" : undefined,
  }),
  head: () =>
    pageHead({
      title: "Admin | TryAITools",
      description: "Private admin area.",
      path: "/admin",
      noindex: true,
    }),
  component: AdminRoute,
});

function AdminRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin" });
  return <AdminApp search={search} nav={(s) => void navigate({ to: "/admin", search: s })} />;
}
