// Old AI Courses URLs. /courses moved to /learn/courses; /courses/<slug> moved to /learn/courses/<slug> or
// /learn/books/<slug> depending on the entry's kind. One indexed lookup (courses.slug is unique), no rendering.
// No runtime imports: the static gate bundles this file as well as the app.
import type { D1DatabaseLike } from "@/lib/db/types";

/** The new path for an old /courses/<slug>, or null when there is no published entry with that slug. */
export async function legacyCoursePath(db: D1DatabaseLike | null, slug: string) {
  if (!db) return null;
  try {
    const r = await db
      .prepare("SELECT kind FROM courses WHERE slug = ? AND status = 'published'")
      .bind(slug)
      .first<{ kind: string }>();
    if (!r) return null;
    return `${r.kind === "book" ? "/learn/books" : "/learn/courses"}/${slug}`;
  } catch (e) {
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}
