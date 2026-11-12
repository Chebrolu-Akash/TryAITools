// Courses & books, gadgets and sponsored guest articles: one list and one editor, driven by the field specs below.
// The server (src/lib/admin/sections.ts + validation.ts) re-checks every value; nothing here is trusted.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { mediaUrl } from "@/lib/media";
import { MarkdownToolbar } from "./BlogView";
import { AdminApiError, api, qs, uploadImage } from "./client";
import { isDirty, linesToList, listToLines, newClientId, slugify } from "./forms";
import { MarkdownView } from "./MarkdownView";
import {
  Banner,
  btnDanger,
  btnGhost,
  btnPrimary,
  card,
  CharCount,
  ConfirmDialog,
  EmptyState,
  errorMessage,
  Field,
  fmtDate,
  inputCls,
  LoadingBlock,
  PageHeader,
  StatusBadge,
  useAsync,
  useDebounced,
  useDirtyGuard,
  useToast,
} from "./ui";
import type { Nav } from "./AdminApp";

export type SectionView = "courses" | "gadgets" | "guest-articles" | "tutorials";
type Item = {
  id: string;
  slug: string;
  title: string;
  status: string;
  published_at: string | null;
  updated_at: string;
  [column: string]: unknown;
};
type Image = { id: string; url: string } | null;
type Retailer = { name: string; url: string };
type Form = Record<string, string | boolean | Image | Retailer[]>;

type Spec = { k: string; label: string; hint?: string; wide?: boolean } & (
  | { type: "text" | "url" | "email" | "textarea"; max: number }
  | { type: "markdown"; max: number }
  | { type: "select"; options: readonly (readonly [string, string])[] }
  | { type: "checkbox" | "number" | "retailers" }
  | { type: "lines"; max: number }
  | { type: "image" }
);
type Group = { title: string; note?: string; fields: Spec[] };

const INDEXING = [
  ["noindex", "Hidden from search (noindex)"],
  ["index", "Allow search indexing"],
] as const;
const seoGroup = (extra: Spec[] = []): Group => ({
  title: "SEO",
  fields: [
    { k: "indexing", label: "Search indexing", type: "select", options: INDEXING },
    { k: "seo_title", label: "SEO title", type: "text", max: 70 },
    ...extra,
    { k: "seo_description", label: "Meta description", type: "textarea", max: 170, wide: true },
  ],
});

type Config = {
  title: string;
  noun: string;
  description: string;
  statuses: readonly string[];
  groups: Group[];
  /** the Markdown field shown with a live preview */
  body: string;
  /** a short label for the list's extra column */
  extra: { head: string; cell: (i: Item) => string };
  publishText: string;
};

const CONFIG: Record<SectionView, Config> = {
  tutorials: {
    title: "Tutorials",
    noun: "tutorial",
    description:
      "AI tutorials for the Learning Hub: written here, linked from elsewhere, or both. New tutorials start as drafts and stay hidden from search until you allow indexing.",
    statuses: ["draft", "published", "archived"],
    body: "body_md",
    extra: { head: "Difficulty", cell: (i) => String(i["difficulty"] ?? "") },
    publishText: "It appears on the public AI Tutorials page in the Learning Hub.",
    groups: [
      {
        title: "Details",
        fields: [
          { k: "author_or_provider", label: "Author or provider", type: "text", max: 120 },
          {
            k: "difficulty",
            label: "Difficulty",
            type: "select",
            options: [
              ["beginner", "Beginner"],
              ["intermediate", "Intermediate"],
              ["advanced", "Advanced"],
            ],
          },
          {
            k: "summary",
            label: "Summary (required to publish)",
            type: "textarea",
            max: 300,
            wide: true,
          },
          { k: "format", label: "Format", type: "text", max: 40, hint: "e.g. Article, Video" },
          { k: "duration", label: "Duration", type: "text", max: 40, hint: "e.g. 20 min" },
          { k: "is_free", label: "Free", type: "checkbox" },
          { k: "topics", label: "Topics", type: "lines", max: 8, hint: "One per line, up to 8" },
          { k: "image_id", label: "Image", type: "image", wide: true },
        ],
      },
      {
        title: "Link",
        note: 'Optional when the tutorial is written below. Affiliate links open with rel="sponsored nofollow"; https only.',
        fields: [
          { k: "resource_url", label: "Tutorial link", type: "url", max: 500 },
          { k: "is_affiliate", label: "This is an affiliate link", type: "checkbox" },
          { k: "featured", label: "Featured", type: "checkbox" },
          { k: "sort_order", label: "Sort order", type: "number", hint: "Lower shows first" },
        ],
      },
      {
        title: "Tutorial",
        fields: [{ k: "body_md", label: "Tutorial", type: "markdown", max: 100_000 }],
      },
      seoGroup(),
    ],
  },
  courses: {
    title: "Courses & books",
    noun: "course",
    description:
      "Affiliate courses and books for the AI Learning Hub (/learn/courses and /learn/books). New entries start as drafts and stay hidden from search until you allow indexing.",
    statuses: ["draft", "published", "archived"],
    body: "review_md",
    extra: { head: "Kind", cell: (i) => String(i["kind"] ?? "") },
    publishText:
      "It appears in the AI Learning Hub (under Courses or Books). Its link is marked as an affiliate link.",
    groups: [
      {
        title: "Details",
        fields: [
          {
            k: "kind",
            label: "Kind",
            type: "select",
            options: [
              ["course", "Course"],
              ["book", "Book"],
            ],
          },
          { k: "provider_or_author", label: "Provider or author", type: "text", max: 120 },
          {
            k: "summary",
            label: "Summary (required to publish)",
            type: "textarea",
            max: 300,
            wide: true,
          },
          {
            k: "level",
            label: "Level",
            type: "select",
            options: [
              ["all", "All levels"],
              ["beginner", "Beginner"],
              ["intermediate", "Intermediate"],
              ["advanced", "Advanced"],
            ],
          },
          { k: "format", label: "Format", type: "text", max: 40, hint: "e.g. Video, Paperback" },
          { k: "duration", label: "Duration", type: "text", max: 40, hint: "e.g. 6 weeks" },
          { k: "price_text", label: "Price", type: "text", max: 40, hint: "e.g. $49 or Free" },
          { k: "is_free", label: "Free", type: "checkbox" },
          { k: "topics", label: "Topics", type: "lines", max: 8, hint: "One per line, up to 8" },
          { k: "image_id", label: "Image", type: "image", wide: true },
        ],
      },
      {
        title: "Link",
        note: 'Opened with rel="sponsored nofollow". https only.',
        fields: [
          {
            k: "affiliate_url",
            label: "Course/book link (required to publish)",
            type: "url",
            max: 500,
          },
          { k: "affiliate_network", label: "Affiliate network", type: "text", max: 60 },
          { k: "featured", label: "Featured", type: "checkbox" },
          { k: "sort_order", label: "Sort order", type: "number", hint: "Lower shows first" },
        ],
      },
      {
        title: "Review",
        fields: [{ k: "review_md", label: "Review", type: "markdown", max: 50_000 }],
      },
      seoGroup(),
    ],
  },
  gadgets: {
    title: "Gadgets",
    noun: "gadget",
    description:
      "AI gadgets with retailer links. New entries start as drafts and stay hidden from search until you allow indexing.",
    statuses: ["draft", "published", "archived"],
    body: "review_md",
    extra: { head: "Type", cell: (i) => String(i["gadget_type"] ?? "") },
    publishText:
      "It appears on the public AI Gadgets page. Retailer links are marked as affiliate links.",
    groups: [
      {
        title: "Details",
        fields: [
          { k: "brand", label: "Brand", type: "text", max: 80 },
          {
            k: "gadget_type",
            label: "Type",
            type: "select",
            options: [
              ["smart-speakers", "Smart speakers"],
              ["wearables", "Wearables"],
              ["cameras", "Cameras"],
              ["translators", "Translators"],
              ["home-robots", "Home robots"],
              ["ai-pcs", "AI PCs"],
              ["other", "Other"],
            ],
          },
          {
            k: "summary",
            label: "Summary (required to publish)",
            type: "textarea",
            max: 300,
            wide: true,
          },
          {
            k: "features",
            label: "Key features",
            type: "lines",
            max: 5,
            hint: "One per line, up to 5",
          },
          { k: "price_text", label: "Price", type: "text", max: 40, hint: "e.g. From $199" },
          { k: "image_id", label: "Image", type: "image", wide: true },
        ],
      },
      {
        title: "Where to buy",
        note: 'Opened with rel="sponsored nofollow". https only.',
        fields: [
          { k: "retailer", label: "Main retailer", type: "text", max: 60, hint: "e.g. Amazon" },
          {
            k: "affiliate_url",
            label: "Main retailer link (required to publish)",
            type: "url",
            max: 500,
          },
          { k: "alt_retailers", label: "Other retailers", type: "retailers", wide: true },
          { k: "featured", label: "Featured", type: "checkbox" },
          { k: "sort_order", label: "Sort order", type: "number", hint: "Lower shows first" },
        ],
      },
      {
        title: "Review",
        fields: [{ k: "review_md", label: "Review", type: "markdown", max: 50_000 }],
      },
      seoGroup(),
    ],
  },
  "guest-articles": {
    title: "Guest articles",
    noun: "article",
    description:
      "Paid sponsored articles. Each one is labelled as sponsored on the site and can only be published once paid.",
    statuses: ["draft", "review", "published", "archived"],
    body: "body_md",
    extra: {
      head: "Sponsor · payment",
      cell: (i) => `${String(i["sponsor_name"] ?? "")} · ${String(i["payment_status"] ?? "")}`,
    },
    publishText:
      "It appears on the public Guest Articles page with its sponsored label. Its outbound links are marked sponsored.",
    groups: [
      {
        title: "Details",
        fields: [
          { k: "topic", label: "Topic", type: "text", max: 40 },
          {
            k: "excerpt",
            label: "Excerpt (required to publish)",
            type: "textarea",
            max: 300,
            wide: true,
          },
          { k: "cover_image_id", label: "Cover image", type: "image", wide: true },
          {
            k: "cover_alt",
            label: "Cover alt text",
            type: "text",
            max: 200,
            hint: "Required with a cover",
          },
        ],
      },
      {
        title: "Contributor & sponsor",
        note: "The contributor email and payment details are private: they are never shown on the site.",
        fields: [
          { k: "contributor_name", label: "Contributor name *", type: "text", max: 80 },
          { k: "contributor_email", label: "Contributor email (private)", type: "email", max: 120 },
          { k: "sponsor_name", label: "Sponsor *", type: "text", max: 120 },
          { k: "sponsor_url", label: "Sponsor link", type: "url", max: 500 },
          {
            k: "sponsor_label",
            label: "Disclosure label",
            type: "select",
            options: [
              ["Sponsored", "Sponsored"],
              ["Paid partnership", "Paid partnership"],
              ["Partner content", "Partner content"],
            ],
          },
          {
            k: "payment_status",
            label: "Payment (private)",
            type: "select",
            options: [
              ["unpaid", "Unpaid"],
              ["paid", "Paid"],
              ["refunded", "Refunded"],
            ],
          },
          { k: "payment_ref", label: "Payment reference (private)", type: "text", max: 80 },
        ],
      },
      { title: "Body", fields: [{ k: "body_md", label: "Body", type: "markdown", max: 100_000 }] },
      seoGroup([{ k: "canonical_url", label: "Canonical URL", type: "url", max: 500 }]),
    ],
  },
};

const DEFAULTS: Partial<Record<string, string | boolean>> = {
  kind: "course",
  level: "all",
  gadget_type: "other",
  difficulty: "beginner",
  indexing: "noindex",
  sponsor_label: "Sponsored",
  payment_status: "unpaid",
  sort_order: "0",
};
const specs = (c: Config) => c.groups.flatMap((g) => g.fields);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function emptyForm(c: Config, view: SectionView): Form {
  const f: Form = { title: "", slug: "" };
  for (const s of specs(c)) {
    if (s.type === "checkbox") f[s.k] = false;
    else if (s.type === "image") f[s.k] = null;
    else if (s.type === "retailers") f[s.k] = [];
    else f[s.k] = DEFAULTS[s.k] ?? "";
  }
  if (view === "guest-articles") f["indexing"] = "index";
  return f;
}

function formFromApi(c: Config, i: Item): Form {
  const f: Form = { title: str(i.title), slug: str(i.slug) };
  for (const s of specs(c)) {
    const v = i[s.k];
    if (s.type === "checkbox") f[s.k] = v === true;
    else if (s.type === "lines") f[s.k] = listToLines(v);
    else if (s.type === "retailers")
      f[s.k] = Array.isArray(v)
        ? v.map((r: Retailer) => ({ name: str(r.name), url: str(r.url) }))
        : [];
    else if (s.type === "image") {
      const url = mediaUrl(v, i["image_mime"]);
      f[s.k] = typeof v === "string" && url ? { id: v, url } : null;
    } else f[s.k] = str(v);
  }
  return f;
}

function payload(c: Config, f: Form) {
  const out: Record<string, unknown> = { title: f["title"] };
  for (const s of specs(c)) {
    const v = f[s.k];
    if (s.type === "lines") out[s.k] = linesToList(String(v));
    else if (s.type === "number") out[s.k] = Number(v) || 0;
    else if (s.type === "image") out[s.k] = (v as Image)?.id ?? null;
    else out[s.k] = v;
  }
  return out;
}

const actionsFor = (s: string, review: boolean): string[] =>
  s === "draft"
    ? review
      ? ["send_to_review", "publish", "archive"]
      : ["publish", "archive"]
    : s === "review"
      ? ["publish", "archive"]
      : s === "published"
        ? ["unpublish", "archive"]
        : ["restore"];

const ACTION_COPY = (
  c: Config,
): Record<string, { label: string; text: string; destructive?: boolean }> => ({
  send_to_review: {
    label: "Send to review",
    text: "It is marked as in review. Nothing is published.",
  },
  publish: { label: "Publish", text: c.publishText },
  unpublish: {
    label: "Unpublish",
    text: "It is removed from the public site and returns to draft. The original publication date is kept.",
    destructive: true,
  },
  archive: {
    label: "Archive",
    text: "It is hidden and can be restored later. Nothing is deleted.",
    destructive: true,
  },
  restore: {
    label: "Restore to draft",
    text: "It returns as a draft; it is not published automatically.",
  },
});

export function SectionList({ view, nav }: { view: SectionView; nav: Nav }) {
  const c = CONFIG[view];
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, status]);
  const list = useAsync(
    () =>
      api.get<{ items: Item[]; total: number; pageSize: number }>(
        `${view}${qs({ q: dq, status, page, pageSize: 25 })}`,
      ),
    [view, dq, status, page],
  );
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtered = !!(q || status);
  const add = (
    <button type="button" className={btnPrimary} onClick={() => nav({ view, new: "1" })}>
      <Plus className="h-4 w-4" /> New {c.noun}
    </button>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={c.title} description={c.description} actions={add} />
      <div className="flex flex-wrap items-end gap-3 rounded-3xl border border-primary/10 bg-card p-4 shadow-card">
        <label className="min-w-[14rem] flex-1 text-sm font-semibold">
          Search
          <input
            type="search"
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title or slug"
            className={`${inputCls} mt-1 font-normal`}
          />
        </label>
        <label className="text-sm font-semibold">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${inputCls} mt-1 font-normal capitalize`}
          >
            <option value="">All</option>
            {c.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setQ("");
              setStatus("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {list.error ? (
        <Banner kind="error">
          {errorMessage(list.error)}{" "}
          {(list.error as AdminApiError).status === 500 &&
            "If you have not applied migration 0004_content_sections.sql to this database yet, do that first."}{" "}
          <button className="font-bold underline" onClick={list.reload}>
            Retry
          </button>
        </Banner>
      ) : list.loading && !d ? (
        <LoadingBlock label={`Loading ${c.title.toLowerCase()}…`} />
      ) : d && d.items.length === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches these filters" />
        ) : (
          <EmptyState
            title={`No ${c.title.toLowerCase()} yet`}
            text="Add your first draft. Nothing is published until you choose Publish."
            action={add}
          />
        )
      ) : d ? (
        <>
          <div className="overflow-x-auto rounded-3xl border border-primary/10 bg-card shadow-card">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">{c.title}</caption>
              <thead className="bg-accent/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Title
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {c.extra.head}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/10">
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-3">
                      <div className="font-bold">{i.title}</div>
                      <div className="text-xs text-muted-foreground">/{i.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.extra.cell(i)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmtDate(i.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className={btnGhost}
                        aria-label={`Edit ${i.title}`}
                        onClick={() => nav({ view, slug: i.slug })}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className={btnGhost}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className={btnGhost}
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

type Media = { id: string; url: string; alt: string | null; width: number; height: number };

/** Upload a new image, pick an uploaded one, or remove it. Files are checked again on the server (type, size, bytes). */
export function ImageField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: Image;
  onChange: (v: Image) => void;
  error?: string | undefined;
}) {
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function upload(file: File) {
    setMsg(null);
    if (file.size > 2 * 1024 * 1024) return setMsg("Images must be 2 MB or smaller.");
    if (!/^image\/(png|jpeg|webp|avif)$/.test(file.type))
      return setMsg("Upload a PNG, JPEG, WebP or AVIF image.");
    setBusy(true);
    try {
      const r = await uploadImage<{ media: Media }>(file, alt);
      onChange({ id: r.media.id, url: r.media.url });
      toast.success("Image uploaded.");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="text-sm">
      <span className="mb-1 block font-semibold text-foreground">{label}</span>
      <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-primary/10 bg-background p-3">
        {value ? (
          <img
            src={value.url}
            alt=""
            className="h-24 w-36 rounded-xl border border-primary/10 object-cover"
          />
        ) : (
          <div className="grid h-24 w-36 place-items-center rounded-xl border border-dashed border-primary/20 text-xs text-muted-foreground">
            No image
          </div>
        )}
        <div className="min-w-[14rem] flex-1 space-y-2">
          <label className="block text-xs font-semibold">
            Alt text for a new upload
            <input
              className={`${inputCls} mt-1 font-normal`}
              value={alt}
              maxLength={200}
              onChange={(e) => setAlt(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              aria-label={`Upload ${label.toLowerCase()}`}
              onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
            />
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setPicking((p) => !p)}>
              {picking ? "Close library" : "Choose uploaded"}
            </button>
            {value && (
              <>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(`![${alt || "Image"}](${value.url})`)
                      .then(() => toast.success("Markdown copied."))
                  }
                >
                  <Copy className="h-4 w-4" /> Copy Markdown
                </button>
                <button type="button" className={btnDanger} onClick={() => onChange(null)}>
                  <X className="h-4 w-4" /> Remove
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPEG, WebP or AVIF, up to 2 MB.</p>
          {(msg || error) && (
            <p role="alert" className="text-xs font-semibold text-destructive">
              {msg ?? error}
            </p>
          )}
        </div>
      </div>
      {picking && (
        <MediaPicker
          onPick={(m) => {
            onChange({ id: m.id, url: m.url });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function MediaPicker({ onPick }: { onPick: (m: Media) => void }) {
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.get<{ items: Media[]; pageSize: number }>(`media${qs({ page, pageSize: 24 })}`),
    [page],
  );
  const toast = useToast();
  async function remove(m: Media) {
    if (!window.confirm("Delete this image permanently? Images still in use cannot be deleted."))
      return;
    try {
      await api.del(`media/${m.id}`, {});
      toast.success("Image deleted.");
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  const d = list.data;
  return (
    <div className="mt-2 rounded-2xl border border-primary/10 bg-card p-3">
      {list.error ? (
        <Banner kind="error">{errorMessage(list.error)}</Banner>
      ) : !d ? (
        <LoadingBlock label="Loading images…" rows={2} />
      ) : d.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No images uploaded yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {d.items.map((m) => (
            <li key={m.id} className="group relative">
              <button
                type="button"
                className="block w-full overflow-hidden rounded-xl border border-primary/10 hover:border-primary"
                onClick={() => onPick(m)}
                aria-label={`Use image ${m.alt ?? m.id}`}
              >
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
              </button>
              <button
                type="button"
                className="absolute right-1 top-1 rounded-full bg-card/90 p-1 text-destructive opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                aria-label="Delete image"
                onClick={() => void remove(m)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {d && (page > 1 || d.items.length === d.pageSize) && (
        <div className="mt-2 flex justify-between text-xs">
          <button
            type="button"
            className={btnGhost}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={d.items.length < d.pageSize}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function RetailersField({
  value,
  onChange,
  errors,
}: {
  value: Retailer[];
  onChange: (v: Retailer[]) => void;
  errors: Record<string, string>;
}) {
  const setRow = (i: number, r: Partial<Retailer>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...r } : x)));
  return (
    <div className="text-sm">
      <span className="mb-1 block font-semibold text-foreground">Other retailers</span>
      <div className="space-y-2">
        {value.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Field label={`Retailer ${i + 1} name`} error={errors[`alt_retailers.${i}.name`]}>
              <input
                className={inputCls}
                value={r.name}
                maxLength={60}
                onChange={(e) => setRow(i, { name: e.target.value })}
              />
            </Field>
            <Field label={`Retailer ${i + 1} link`} error={errors[`alt_retailers.${i}.url`]}>
              <input
                className={inputCls}
                type="url"
                value={r.url}
                onChange={(e) => setRow(i, { url: e.target.value })}
              />
            </Field>
            <button
              type="button"
              className={`${btnGhost} self-end`}
              aria-label={`Remove retailer ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {value.length < 4 && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => onChange([...value, { name: "", url: "" }])}
          >
            <Plus className="h-4 w-4" /> Add retailer
          </button>
        )}
        {errors["alt_retailers"] && (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {errors["alt_retailers"]}
          </p>
        )}
      </div>
    </div>
  );
}

export function SectionEditor({
  view,
  slug,
  nav,
}: {
  view: SectionView;
  slug?: string | undefined;
  nav: Nav;
}) {
  const c = CONFIG[view];
  const copy = ACTION_COPY(c);
  const isNew = !slug;
  const loaded = useAsync(
    () =>
      slug ? api.get<{ item: Item }>(`${view}/${encodeURIComponent(slug)}`) : Promise.resolve(null),
    [view, slug],
  );
  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm(c, view));
  const [base, setBase] = useState<Form>(() => emptyForm(c, view));
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const clientId = useRef(newClientId());
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  const load = (i: Item) => {
    setItem(i);
    const f = formFromApi(c, i);
    setForm(f);
    setBase(f);
  };
  useEffect(() => {
    if (loaded.data?.item) load(loaded.data.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);
  const dirty = isDirty(form, base);
  const guard = useDirtyGuard(dirty);
  const set = (k: string, v: Form[string]) => setForm((f) => ({ ...f, [k]: v }));
  const path = (s: string) => `${view}/${encodeURIComponent(s)}`;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setBanner(null);
    setErrors({});
    try {
      if (isNew) {
        const r = await api.post<{ item: Item }>(view, {
          client_id: clientId.current,
          slug: form["slug"],
          ...payload(c, form),
        });
        setBase(form);
        guard.clear();
        toast.success(`Draft "${r.item.title}" created.`);
        nav({ view, slug: r.item.slug });
      } else {
        const r = await api.put<{ item: Item }>(path(slug!), {
          updated_at: item!.updated_at,
          ...payload(c, form),
        });
        load(r.item);
        toast.success("Saved. The database confirmed the change.");
      }
    } catch (err) {
      if (err instanceof AdminApiError) setErrors(err.fields);
      setBanner({ kind: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function runAction() {
    if (!pending || !item) return;
    setActing(true);
    try {
      const r = await api.post<{ item: Item }>(`${path(item.slug)}/action`, {
        action: pending,
        updated_at: item.updated_at,
      });
      load(r.item);
      setBanner(null);
      toast.success(`${copy[pending]!.label}: done. The database confirmed the change.`);
    } catch (err) {
      setBanner({ kind: "error", text: errorMessage(err) });
    } finally {
      setActing(false);
      setPending(null);
    }
  }

  async function runDelete() {
    if (!item) return;
    setDeleting(true);
    try {
      await api.del(path(item.slug), { updated_at: item.updated_at, confirm: item.slug });
      guard.clear();
      toast.success(`"${item.title}" was deleted permanently.`);
      nav({ view });
    } catch (err) {
      setBanner({ kind: "error", text: errorMessage(err) });
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (!isNew && loaded.loading && !item) return <LoadingBlock label="Loading…" rows={8} />;
  if (!isNew && loaded.error)
    return (
      <Banner kind="error">
        {errorMessage(loaded.error)}{" "}
        <button className="font-bold underline" onClick={() => nav({ view })}>
          Back to {c.title.toLowerCase()}
        </button>
      </Banner>
    );

  const renderField = (s: Spec) => {
    const v = form[s.k];
    const err = errors[s.k];
    const wide = s.wide ? "sm:col-span-2" : "";
    switch (s.type) {
      case "markdown":
        return (
          <div key={s.k} className="sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Headings, **bold**, *italic*, `code`, links, lists, quotes, code blocks, and images
                uploaded here (use Copy Markdown on an image).
              </p>
              <div
                role="tablist"
                aria-label="Editor view"
                className="flex rounded-full border border-primary/20 p-0.5 text-sm lg:hidden"
              >
                {(["write", "preview"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-full px-3 py-1 font-semibold capitalize ${tab === t ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className={tab === "preview" ? "hidden lg:block" : ""}>
                <MarkdownToolbar target={bodyRef} value={String(v)} onChange={(x) => set(s.k, x)} />
                <label className="sr-only" htmlFor={`f-${s.k}`}>
                  {s.label} in Markdown
                </label>
                <textarea
                  ref={bodyRef}
                  id={`f-${s.k}`}
                  className={`${inputCls} font-mono`}
                  rows={18}
                  maxLength={s.max}
                  value={String(v)}
                  onChange={(e) => set(s.k, e.target.value)}
                />
                {err && (
                  <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
                    {err}
                  </p>
                )}
              </div>
              <div
                className={`rounded-2xl border border-primary/10 bg-background p-4 ${tab === "write" ? "hidden lg:block" : ""}`}
                aria-label="Preview"
              >
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Preview
                </h4>
                <MarkdownView source={String(v)} sponsored />
              </div>
            </div>
          </div>
        );
      case "image":
        return (
          <div key={s.k} className={wide}>
            <ImageField
              label={s.label}
              value={v as Image}
              onChange={(x) => set(s.k, x)}
              error={err}
            />
          </div>
        );
      case "retailers":
        return (
          <div key={s.k} className={wide}>
            <RetailersField value={v as Retailer[]} onChange={(x) => set(s.k, x)} errors={errors} />
          </div>
        );
      case "checkbox":
        return (
          <label key={s.k} className="flex items-center gap-2 self-end text-sm font-semibold">
            <input
              type="checkbox"
              checked={v === true}
              onChange={(e) => set(s.k, e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {s.label}
          </label>
        );
      case "select":
        return (
          <div key={s.k} className={wide}>
            <Field label={s.label} error={err} hint={s.hint}>
              <select
                className={inputCls}
                value={String(v)}
                onChange={(e) => set(s.k, e.target.value)}
              >
                {s.options.map(([val, text]) => (
                  <option key={val} value={val}>
                    {text}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        );
      case "textarea":
      case "lines":
        return (
          <div key={s.k} className={s.type === "lines" ? wide : "sm:col-span-2"}>
            <Field
              label={s.label}
              error={err}
              hint={s.type === "textarea" ? <CharCount value={String(v)} max={s.max} /> : s.hint}
            >
              <textarea
                className={inputCls}
                rows={s.type === "lines" ? 4 : 2}
                maxLength={s.type === "textarea" ? s.max : undefined}
                value={String(v)}
                onChange={(e) => set(s.k, e.target.value)}
              />
            </Field>
          </div>
        );
      default:
        return (
          <div key={s.k} className={wide}>
            <Field label={s.label} error={err} hint={s.hint}>
              <input
                className={inputCls}
                type={s.type === "number" ? "number" : s.type}
                min={s.type === "number" ? 0 : undefined}
                maxLength={"max" in s ? s.max : undefined}
                value={String(v)}
                onChange={(e) => set(s.k, e.target.value)}
              />
            </Field>
          </div>
        );
    }
  };

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            className="text-sm font-semibold text-primary hover:underline"
            onClick={() => nav({ view })}
          >
            ← All {c.title.toLowerCase()}
          </button>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
            {isNew ? `New ${c.noun}` : item?.title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              Unsaved changes
            </span>
          )}
          <button type="submit" className={btnPrimary} disabled={saving || !dirty}>
            {saving ? "Saving…" : isNew ? "Create draft" : "Save changes"}
          </button>
        </div>
      </div>
      {banner && (
        <Banner kind={banner.kind} onClose={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      {item && (
        <section className={card} aria-labelledby="sw-h">
          <h3 id="sw-h" className="text-lg font-extrabold">
            Publishing
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={item.status} />
            <span className="text-muted-foreground">
              Published {fmtDate(item.published_at)} · Updated {fmtDate(item.updated_at)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {actionsFor(item.status, view === "guest-articles").map((a) => (
              <button
                key={a}
                type="button"
                className={copy[a]!.destructive ? btnDanger : btnGhost}
                disabled={dirty || saving}
                onClick={() => setPending(a)}
              >
                {copy[a]!.label}
              </button>
            ))}
            {item.status !== "published" && (
              <button
                type="button"
                className={btnDanger}
                disabled={dirty || saving}
                onClick={() => setDeleteOpen(true)}
              >
                Delete permanently
              </button>
            )}
          </div>
          {dirty && (
            <p className="mt-2 text-xs text-muted-foreground">
              Save your edits before publishing or changing state.
            </p>
          )}
        </section>
      )}

      <section className={`${card} grid gap-4 sm:grid-cols-2`} aria-labelledby="sb-h">
        <h3 id="sb-h" className="text-lg font-extrabold sm:col-span-2">
          Title
        </h3>
        <Field label="Title *" error={errors["title"]}>
          <input
            className={inputCls}
            value={String(form["title"])}
            maxLength={160}
            onChange={(e) => {
              set("title", e.target.value);
              if (isNew && !slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </Field>
        <Field
          label="Slug *"
          error={errors["slug"]}
          hint={isNew ? "Permanent once created." : "Slugs cannot be changed."}
        >
          <input
            className={inputCls}
            value={String(form["slug"])}
            maxLength={80}
            disabled={!isNew}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value);
            }}
          />
        </Field>
      </section>

      {c.groups.map((g, gi) => (
        <section
          key={g.title}
          className={`${card} grid gap-4 sm:grid-cols-2`}
          aria-labelledby={`sg-${gi}`}
        >
          <div className="sm:col-span-2">
            <h3 id={`sg-${gi}`} className="text-lg font-extrabold">
              {g.title}
            </h3>
            {g.note && <p className="mt-1 text-xs text-muted-foreground">{g.note}</p>}
          </div>
          {g.fields.map(renderField)}
        </section>
      ))}

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete this ${c.noun} permanently?`}
        description={`"${item?.title}" is removed from the database. This cannot be undone. The audit log keeps a record.`}
        confirmLabel="Delete permanently"
        destructive
        busy={deleting}
        confirmText={item?.slug ?? ""}
        onConfirm={runDelete}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${copy[pending]!.label}?` : ""}
        description={pending ? copy[pending]!.text : ""}
        confirmLabel={pending ? copy[pending]!.label : ""}
        destructive={pending ? copy[pending]!.destructive === true : false}
        busy={acting}
        onConfirm={runAction}
        onCancel={() => setPending(null)}
      />
    </form>
  );
}
