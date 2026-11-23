// Test fixture: gives a tool a complete, approved review that passes the indexing gate (G1–G10) at `now`, written
// straight into the test database (as an approval through the admin would). Each tool gets its own words, so two
// fixtures in the same subcategory never overlap (G8).
type Raw = {
  prepare: (sql: string) => {
    run: (...a: unknown[]) => unknown;
    get: (...a: unknown[]) => unknown;
  };
};

export function passGate(raw: Raw, slug: string, now: string) {
  const w = slug.replace(/[^a-z0-9]/g, "");
  const words = (n: number, from = 0) =>
    Array.from(
      { length: n },
      (_, i) => `${w}${String.fromCharCode(97 + ((i + from) % 26))}${i + from}`,
    ).join(" ");
  const features = [words(8, 100), words(8, 200), words(8, 300)];
  const bestFor = [words(4, 400), words(4, 500)];
  const record = {
    version: 2,
    sources: [{ url: `https://${slug}.example.com/`, checked_at: now, kind: "home" }],
    evidence: {
      features: features.map((f) => f.split(" ").slice(0, 4).join(" ")),
      best_for: bestFor.map((f) => f.split(" ").slice(0, 3).join(" ")),
      pros: [],
      limits: [],
      pricing: "Free plan available for everyone",
    },
    quotes_verified_at: now,
    pricing_kept: null,
    identity: { matches: true, name_on_site: slug, signals: [] },
  };
  const t = raw.prepare("SELECT id, category_id FROM tools WHERE slug = ?").get(slug) as {
    id: string;
    category_id: string;
  };
  raw
    .prepare(
      `UPDATE tools SET tagline = ?, overview = ?, features = ?, best_for = ?, pros = '[]', limits = '[]',
         pricing_model = 'freemium', pricing_note = NULL, pricing_source = ?, pricing_checked_at = ?,
         review_sources = ?, review_status = 'reviewed', reviewed_at = ?, url_status = 'ok', url_checked_at = ?,
         content_source = 'admin', needs_review = 0
       WHERE slug = ?`,
    )
    .run(
      `${w} helps teams work faster`,
      words(100, 600),
      JSON.stringify(features),
      bestFor.join("; "),
      `https://${slug}.example.com/pricing`,
      now.slice(0, 10),
      JSON.stringify(record),
      now,
      now,
      slug,
    );
  raw
    .prepare(
      `INSERT INTO tool_review_history (tool_id, slug, at, actor_email, action, before, after, checklist)
       VALUES (?, ?, ?, 'editor@example.com', 'approve', '{}', '{}', ?)`,
    )
    .run(
      t.id,
      slug,
      now,
      JSON.stringify({
        claims_checked: true,
        own_wording: true,
        pricing_confirmed: true,
        category_confirmed: true,
        category_id: t.category_id,
      }),
    );
}
