// Serves an uploaded image from R2. Only /media/<uuid>.<png|jpg|webp|avif> is answered (MEDIA_PATH), so no other R2
// key can be requested; the stored content type is replaced by the one the extension implies, and the response cannot
// be sniffed into anything else. Files are immutable (a new upload gets a new id), so they are cached for a year.
import { MEDIA_PATH, MEDIA_TYPES } from "@/lib/media";
import { SECURITY_HEADERS } from "@/lib/security-headers";

/** The part of an R2 bucket binding this needs. */
export type MediaReader = {
  get(key: string): Promise<{ body: ReadableStream; size: number; httpEtag?: string } | null>;
};

const MIME_BY_EXT = Object.fromEntries(
  Object.entries(MEDIA_TYPES).map(([mime, ext]) => [ext, mime]),
) as Record<string, string>;

const plain = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });

export async function serveMedia(request: Request, bucket: MediaReader | null): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return plain(405, "Method not allowed");
  const m = MEDIA_PATH.exec(new URL(request.url).pathname);
  if (!m) return plain(404, "Not found");
  if (!bucket) return plain(404, "Not found");
  let obj: Awaited<ReturnType<MediaReader["get"]>>;
  try {
    obj = await bucket.get(`media/${m[1]}.${m[2]}`);
  } catch (e) {
    console.error("media: read failed", e instanceof Error ? e.message : e);
    return plain(503, "Temporarily unavailable");
  }
  if (!obj) return plain(404, "Not found");
  const etag = obj.httpEtag;
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    "content-type": MIME_BY_EXT[m[2]!]!,
    "content-length": String(obj.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    ...(etag ? { etag } : {}),
  };
  if (etag && request.headers.get("if-none-match") === etag) {
    obj.body.cancel().catch(() => {});
    return new Response(null, { status: 304, headers });
  }
  if (method === "HEAD") {
    obj.body.cancel().catch(() => {});
    return new Response(null, { status: 200, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}
