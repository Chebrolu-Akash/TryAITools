// Identifies an uploaded image from its BYTES (never the file name or the browser's content type) and reads its size.
// Only PNG, JPEG, WebP and AVIF are accepted. SVG and everything else are refused: SVG can carry script.
import type { MediaMime } from "@/lib/media";

export type ImageInfo = { mime: MediaMime; width: number | null; height: number | null };

const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length < 16) return null;
  if (b[0] === 0x89 && ascii(b, 1, "PNG\r\n\u001a\n"))
    return { mime: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // JPEG: walk the segments to the first start-of-frame marker for the size.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1]!;
      const len = u16be(b, i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { mime: "image/jpeg", width: u16be(b, i + 7), height: u16be(b, i + 5) };
      i += 2 + len;
    }
    return { mime: "image/jpeg", width: null, height: null };
  }
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    if (ascii(b, 12, "VP8X") && b.length >= 30)
      return { mime: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (ascii(b, 12, "VP8L") && b.length >= 25) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return {
        mime: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (ascii(b, 12, "VP8 ") && b.length >= 30)
      return {
        mime: "image/webp",
        width: (b[26]! | (b[27]! << 8)) & 0x3fff,
        height: (b[28]! | (b[29]! << 8)) & 0x3fff,
      };
    return { mime: "image/webp", width: null, height: null };
  }
  if (ascii(b, 4, "ftyp") && (ascii(b, 8, "avif") || ascii(b, 8, "avis"))) {
    // AVIF: the first "ispe" box carries the size.
    for (let i = 12; i + 20 < Math.min(b.length, 4096); i++)
      if (ascii(b, i, "ispe"))
        return { mime: "image/avif", width: u32be(b, i + 8), height: u32be(b, i + 12) };
    return { mime: "image/avif", width: null, height: null };
  }
  return null;
}
