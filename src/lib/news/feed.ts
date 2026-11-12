// A small RSS 2.0 / Atom parser for news feeds. No dependencies and no DOM: it scans the document with indexOf and stops
// after `max` items, so a large feed (OpenAI's is ~800 KB) costs only the bytes it reads (Workers Free allows 10 ms of
// CPU per invocation). Only what the pipeline needs is extracted: title, link, GUID, date, text and an image URL.

export type FeedItem = {
  title: string;
  link: string;
  guid: string | null;
  publishedAt: string | null;
  /** Plain text of the item's description/content (HTML stripped, entities decoded). */
  text: string;
  imageUrl: string | null;
};

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** Visible text of an HTML fragment: scripts/styles dropped, tags removed, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Inner XML of the first <tag ...>...</tag> (tag may include a namespace prefix), or null. */
function inner(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, "i");
  const m = re.exec(xml);
  return m ? (m[1] ?? "") : null;
}
const attr = (tagXml: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i")
    .exec(tagXml)
    ?.slice(2)
    .find((v) => v !== undefined) ?? null;
const text = (xml: string, tag: string) => {
  const v = inner(xml, tag);
  return v === null ? null : decodeEntities(unCdata(v)).trim();
};
const https = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const url = new URL(decodeEntities(u.trim()));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};
const isoDate = (s: string | null): string | null => {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function atomLink(entry: string): string | null {
  let fallback: string | null = null;
  for (const m of entry.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = attr(tag, "rel");
    const href = attr(tag, "href");
    if (!href) continue;
    if (!rel || rel === "alternate") return href;
    fallback ??= href;
  }
  return fallback;
}

function imageOf(item: string, html: string): string | null {
  for (const m of item.matchAll(/<(media:content|media:thumbnail|enclosure)\b[^>]*>/gi)) {
    const tag = m[0];
    const type = attr(tag, "type") ?? attr(tag, "medium") ?? "";
    if (m[1]!.toLowerCase() === "enclosure" && !/^image/i.test(type)) continue;
    if (/video|audio/i.test(type)) continue;
    const url = https(attr(tag, "url"));
    if (url) return url;
  }
  // Otherwise the first real image in the body: WordPress emoji, tracking pixels and tiny icons are skipped.
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src");
    if (!src || /wp-smiley|emoji/i.test(tag) || /\/emoji\/|pixel|spacer|\.gif(\?|$)/i.test(src))
      continue;
    const w = Number(attr(tag, "width"));
    const h = Number(attr(tag, "height"));
    if ((w > 0 && w < 200) || (h > 0 && h < 120)) continue;
    const url = https(src);
    if (url) return url;
  }
  return null;
}

/** Parses at most `max` items, in document order (feeds list the newest first). Throws if this is not a feed. */
export function parseFeed(xml: string, max = 10): FeedItem[] {
  const atom = !/<rss[\s>]|<rdf:RDF[\s>]/i.test(xml.slice(0, 2000)) && /<feed[\s>]/i.test(xml);
  if (!atom && !/<(rss|rdf:RDF|channel)[\s>]/i.test(xml.slice(0, 5000)))
    throw new Error("not an RSS or Atom feed");
  const open = atom ? "<entry" : "<item";
  const close = atom ? "</entry>" : "</item>";
  const out: FeedItem[] = [];
  let at = 0;
  while (out.length < max) {
    let start = xml.indexOf(open, at);
    // skip <items> / <itemDate>-style tags
    while (start >= 0 && !/[\s>]/.test(xml[start + open.length] ?? ""))
      start = xml.indexOf(open, start + 1);
    if (start < 0) break;
    const end = xml.indexOf(close, start);
    if (end < 0) break; // truncated by the byte cap: drop the partial item
    const item = xml.slice(start, end);
    at = end + close.length;

    const title = htmlToText(text(item, "title") ?? "");
    const link = https(
      atom
        ? atomLink(item)
        : (text(item, "link") ?? attr(item.match(/<link\b[^>]*>/i)?.[0] ?? "", "href")),
    );
    const guid = (atom ? text(item, "id") : text(item, "guid")) || null;
    const date =
      isoDate(text(item, atom ? "published" : "pubDate")) ??
      isoDate(text(item, "updated")) ??
      isoDate(text(item, "dc:date"));
    const rawHtml = unCdata(
      inner(item, "content:encoded") ??
        inner(item, "content") ??
        inner(item, "description") ??
        inner(item, "summary") ??
        "",
    );
    // Content may be entity-encoded HTML (common in RSS descriptions): decode once before stripping tags.
    const html = /&lt;[a-z/]/i.test(rawHtml) ? decodeEntities(rawHtml) : rawHtml;
    if (!title || !link) continue;
    out.push({
      title: title.slice(0, 300),
      link,
      guid: guid ? guid.slice(0, 500) : null,
      publishedAt: date,
      text: htmlToText(html).slice(0, 8000),
      imageUrl: imageOf(item, html),
    });
  }
  return out;
}
