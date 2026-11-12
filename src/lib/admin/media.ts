// Image uploads for the admin: bytes are checked (sniffImage), stored in R2 under a random key, and recorded in the media
// table. A file still used by a course, gadget, guest article or blog post cannot be deleted.
import { MAX_MEDIA_BYTES, mediaKey, mediaUrl } from "@/lib/media";
import { auditStep, HttpError, readSafe, writeBatch, type AdminDb } from "./db";
import { sniffImage } from "./image";
import { clampInt, need, type Ctx, type Row } from "./repo";

/** The part of an R2 bucket binding this code uses. */
export type MediaBucket = {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};

const bucketOrFail = (bucket: MediaBucket | null | undefined): MediaBucket => {
  if (!bucket || typeof bucket.put !== "function")
    throw new HttpError(
      503,
      "media_unavailable",
      "Image storage is not configured. Nothing was saved.",
    );
  return bucket;
};

const withUrl = (r: Row): Row => ({ ...r, url: mediaUrl(r["id"], r["mime"]) });

export async function uploadMedia(
  ctx: Ctx,
  bucket: MediaBucket | null | undefined,
  bytes: Uint8Array,
  alt: string | null,
) {
  const d = need(ctx.db);
  const store = bucketOrFail(bucket);
  if (bytes.length === 0) throw new HttpError(422, "empty_file", "The file is empty.");
  if (bytes.length > MAX_MEDIA_BYTES)
    throw new HttpError(413, "payload_too_large", "Images must be 2 MB or smaller.");
  const info = sniffImage(bytes);
  if (!info)
    throw new HttpError(415, "unsupported_image", "Upload a PNG, JPEG, WebP or AVIF image.");
  const id = crypto.randomUUID();
  const key = mediaKey(id, info.mime);
  await store.put(key, bytes, {
    httpMetadata: { contentType: info.mime, cacheControl: "public, max-age=31536000, immutable" },
  });
  try {
    await writeBatch(d, [
      {
        sql: "INSERT INTO media (id, r2_key, mime, bytes, width, height, alt, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          id,
          key,
          info.mime,
          bytes.length,
          info.width,
          info.height,
          alt,
          ctx.actor,
          ctx.now,
        ],
        expectChanges: 1,
      },
      auditStep(ctx.actor, "media.upload", "media", id, `Uploaded ${info.mime} image`, ctx.now, {
        table: "media",
        key: "id",
        value: id,
        stamp: "created_at",
      }),
    ]);
  } catch (e) {
    await store.delete(key).catch(() => {}); // no orphan file when the row could not be written
    throw e;
  }
  return {
    media: withUrl({
      id,
      mime: info.mime,
      bytes: bytes.length,
      width: info.width,
      height: info.height,
      alt,
    }),
  };
}

export async function listMedia(db: AdminDb | null, p: Record<string, string | undefined>) {
  const d = need(db);
  const pageSize = clampInt(p["pageSize"], 1, 100, 40);
  const page = clampInt(p["page"], 1, 100000, 1);
  return readSafe(async () => {
    const rows = await d
      .prepare(
        "SELECT id, mime, bytes, width, height, alt, created_at FROM media ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .bind(pageSize, (page - 1) * pageSize)
      .all<Row>();
    return { items: rows.results.map(withUrl), page, pageSize };
  });
}

const USES = [
  ["courses", "image_id"],
  ["gadgets", "image_id"],
  ["guest_articles", "cover_image_id"],
  ["tutorials", "image_id"],
  ["blog_posts", "cover_image_id"],
] as const;
/** Markdown bodies that may embed /media/<id>.<ext>; matched with LIKE (admin-only, small tables). */
const EMBEDS = [
  ["courses", "review_md"],
  ["gadgets", "review_md"],
  ["guest_articles", "body_md"],
  ["tutorials", "body_md"],
  ["blog_posts", "body_md"],
] as const;

export async function deleteMedia(ctx: Ctx, bucket: MediaBucket | null | undefined, id: string) {
  const d = need(ctx.db);
  const store = bucketOrFail(bucket);
  const row = await readSafe(() =>
    d.prepare("SELECT id, r2_key, mime FROM media WHERE id = ?").bind(id).first<Row>(),
  );
  if (!row) throw new HttpError(404, "not_found", "Image not found.");
  const used = await readSafe(() =>
    d
      .prepare(
        [
          ...USES.map(([t, c]) => `SELECT 1 AS x FROM ${t} WHERE ${c} = ?`),
          ...EMBEDS.map(([t, c]) => `SELECT 1 AS x FROM ${t} WHERE ${c} LIKE ?`),
        ].join(" UNION ALL ") + " LIMIT 1",
      )
      .bind(...USES.map(() => id), ...EMBEDS.map(() => `%/media/${id}.%`))
      .first<Row>(),
  );
  if (used)
    throw new HttpError(
      409,
      "in_use",
      "This image is still used. Remove it from its entries first.",
    );
  await writeBatch(d, [
    {
      sql: "INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) SELECT ?, ?, 'media.delete', 'media', ?, 'Deleted image' WHERE EXISTS (SELECT 1 FROM media WHERE id = ?)",
      params: [ctx.now, ctx.actor, id, id],
      expectChanges: 1,
    },
    { sql: "DELETE FROM media WHERE id = ?", params: [id], expectChanges: 1 },
  ]);
  await store.delete(String(row["r2_key"]));
  return { deleted: true, id };
}
