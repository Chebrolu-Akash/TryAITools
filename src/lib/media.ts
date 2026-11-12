// Uploaded images: their public URL is /media/<id>.<ext>, the R2 object key is media/<id>.<ext>. Deterministic, so the
// public route serves a file from R2 without reading D1.
export const MEDIA_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;
export type MediaMime = keyof typeof MEDIA_TYPES;
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

export const mediaExt = (mime: string): string | null =>
  Object.hasOwn(MEDIA_TYPES, mime) ? MEDIA_TYPES[mime as MediaMime] : null;
export const mediaKey = (id: string, mime: string) => `media/${id}.${mediaExt(mime)}`;
/** Public URL of an uploaded image, or null when there is none. */
export const mediaUrl = (id: unknown, mime: unknown): string | null =>
  typeof id === "string" && typeof mime === "string" && mediaExt(mime)
    ? `/media/${id}.${mediaExt(mime)}`
    : null;
/** /media/<uuid>.<ext> only: what the public route serves and the only images Markdown may embed. */
export const MEDIA_PATH =
  /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(png|jpg|webp|avif)$/;
