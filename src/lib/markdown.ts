// A small, dependency-free Markdown subset that is SAFE BY CONSTRUCTION.
//
// Raw HTML is never interpreted: the parser produces a tree of text/structure nodes and the view
// (src/components/admin/MarkdownView.tsx) turns it into React elements, so every piece of text is escaped
// by React and no HTML string is ever built or injected. Links are allowed only for http(s), mailto and
// same-site paths; the href that is emitted is the URL parser's normalized output.
//
// Supported: # headings, paragraphs, **bold**, *italic* / _italic_, `code`, ``` fenced code, [links](url),
// - / * bullet lists, 1. numbered lists, > quotes, --- rules, and ![alt](/media/<id>.<ext>) images uploaded through the
// admin (no other image source is accepted). HTML is intentionally not supported.

import { MEDIA_PATH } from "./media";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; c: Inline[] }
  | { t: "img"; src: string; alt: string };

export type Block =
  | { t: "h"; level: 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "hr" };

export const MAX_MARKDOWN_LENGTH = 100_000;

/** Returns a normalized safe href, or null when the URL is not allowed. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  if (value.startsWith("//")) return null; // protocol-relative = off-site with an unknown scheme
  if (value.startsWith("/")) {
    try {
      const u = new URL(value, "https://base.invalid");
      return u.origin === "https://base.invalid"
        ? { href: u.pathname + u.search + u.hash, external: false }
        : null;
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(value);
    if (u.protocol === "https:" || u.protocol === "http:")
      return u.username || u.password ? null : { href: u.href, external: true };
    if (u.protocol === "mailto:") return { href: u.href, external: true };
  } catch {
    // fall through
  }
  return null;
}

const MAX_DEPTH = 3;

/** Index of the ")" that closes a link target starting at `from`, allowing balanced parentheses inside the URL. */
function matchingParen(src: string, from: number): number {
  let depth = 0;
  for (let k = from; k < src.length; k++) {
    if (src[k] === "(") depth++;
    else if (src[k] === ")") {
      if (depth === 0) return k;
      depth--;
    }
  }
  return -1;
}

function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < MAX_DEPTH) {
      if (src.startsWith("**", i)) {
        const end = src.indexOf("**", i + 2);
        if (end > i + 2) {
          flush();
          out.push({ t: "strong", c: parseInline(src.slice(i + 2, end), depth + 1) });
          i = end + 2;
          continue;
        }
      }
      if (ch === "*" || ch === "_") {
        const end = src.indexOf(ch, i + 1);
        if (end > i + 1 && src[i + 1] !== " ") {
          flush();
          out.push({ t: "em", c: parseInline(src.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
      if (ch === "!" && src[i + 1] === "[") {
        const close = src.indexOf("](", i + 2);
        const end = close > -1 ? src.indexOf(")", close + 2) : -1;
        if (close > i && end > close) {
          const target = src.slice(close + 2, end).trim();
          const alt = src.slice(i + 2, close);
          flush();
          // Only images uploaded through the admin; anything else keeps just its alt text.
          if (MEDIA_PATH.test(target)) out.push({ t: "img", src: target, alt });
          else buf += alt;
          i = end + 1;
          continue;
        }
      }
      if (ch === "[") {
        const close = src.indexOf("](", i + 1);
        const end = close > -1 ? matchingParen(src, close + 2) : -1;
        if (close > i && end > close) {
          const link = safeHref(src.slice(close + 2, end));
          if (link) {
            flush();
            out.push({
              t: "link",
              href: link.href,
              external: link.external,
              c: parseInline(src.slice(i + 1, close), depth + 1),
            });
          } else {
            // Unsafe or malformed target: keep only the visible label, as plain text.
            buf += src.slice(i + 1, close);
          }
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.slice(0, MAX_MARKDOWN_LENGTH).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: "code", v: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({
        t: "h",
        level: Math.min(6, Math.max(2, h[1].length + 1)) as 2 | 3 | 4 | 5 | 6,
        c: parseInline(h[2]),
      });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: "hr" });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      const items: Inline[][] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const m =
          kind === "ul" ? /^\s*[-*+]\s+(.*)$/.exec(lines[j]) : /^\s*\d+[.)]\s+(.*)$/.exec(lines[j]);
        if (!m) break;
        items.push(parseInline(m[1]));
      }
      blocks.push({ t: kind, items });
      i = j - 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const q: string[] = [];
      let j = i;
      for (; j < lines.length && /^>\s?/.test(lines[j]); j++) q.push(lines[j].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", c: parseInline(q.join(" ")) });
      i = j - 1;
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}
