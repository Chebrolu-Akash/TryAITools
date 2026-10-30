import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Plus, Quote } from "lucide-react";
import { AdminApiError, api, qs } from "./client";
import {
  emptyPostForm,
  isDirty,
  newClientId,
  postFormFromApi,
  postPayload,
  slugify,
  type PostForm,
} from "./forms";
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
import type { PostRecord } from "./types";

type Post = PostRecord;
type PostAction = "publish" | "unpublish" | "archive" | "restore";
const COPY: Record<
  PostAction,
  { label: string; title: string; text: string; destructive?: boolean }
> = {
  publish: {
    label: "Publish",
    title: "Publish this post?",
    text: "The post is marked published with today's date. The public site has no blog pages yet, so nothing becomes visible until they are built and approved.",
  },
  unpublish: {
    label: "Unpublish",
    title: "Unpublish this post?",
    text: "It returns to draft. The original publication date is kept.",
    destructive: true,
  },
  archive: {
    label: "Archive",
    title: "Archive this post?",
    text: "It is hidden and can be restored later. Nothing is deleted.",
    destructive: true,
  },
  restore: {
    label: "Restore to draft",
    title: "Restore this post?",
    text: "It returns as a draft; it is not published automatically.",
  },
};
const actionsFor = (s: string): PostAction[] =>
  s === "draft"
    ? ["publish", "archive"]
    : s === "published"
      ? ["unpublish", "archive"]
      : ["restore"];

export function BlogList({ nav }: { nav: Nav }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, status]);
  const list = useAsync(
    () =>
      api.get<{ items: Post[]; total: number; pageSize: number }>(
        `blog${qs({ q: dq, status, page, pageSize: 25 })}`,
      ),
    [dq, status, page],
  );
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtered = !!(q || status);
  const newPost = (
    <button type="button" className={btnPrimary} onClick={() => nav({ view: "blog", new: "1" })}>
      <Plus className="h-4 w-4" /> New post
    </button>
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Blog"
        description="Markdown posts. New posts start as drafts. The public site has no blog pages yet."
        actions={newPost}
      />
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
            className={`${inputCls} mt-1 font-normal`}
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
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
            "If you have not applied migration 0002_blog.sql to this database yet, do that first."}{" "}
          <button className="font-bold underline" onClick={list.reload}>
            Retry
          </button>
        </Banner>
      ) : list.loading && !d ? (
        <LoadingBlock label="Loading posts…" />
      ) : d && d.items.length === 0 ? (
        filtered ? (
          <EmptyState title="No posts match these filters" />
        ) : (
          <EmptyState
            title="No posts yet"
            text="Write your first draft. Nothing is published until you choose Publish."
            action={newPost}
          />
        )
      ) : d ? (
        <>
          <div className="overflow-x-auto rounded-3xl border border-primary/10 bg-card shadow-card">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Blog posts</caption>
              <thead className="bg-accent/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Post
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Published
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
                {d.items.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <div className="font-bold">{p.title}</div>
                      <div className="text-xs text-muted-foreground">/{p.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmtDate(p.published_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmtDate(p.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className={btnGhost}
                        aria-label={`Edit ${p.title}`}
                        onClick={() => nav({ view: "blog", slug: p.slug })}
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

type Wrap = { label: string; icon: typeof Bold; before: string; after?: string; line?: boolean };
const TOOLBAR: Wrap[] = [
  { label: "Heading", icon: Heading2, before: "## ", line: true },
  { label: "Bold", icon: Bold, before: "**", after: "**" },
  { label: "Italic", icon: Italic, before: "*", after: "*" },
  { label: "Inline code", icon: Code, before: "`", after: "`" },
  { label: "Link", icon: Link2, before: "[", after: "](https://)" },
  { label: "Bulleted list", icon: List, before: "- ", line: true },
  { label: "Numbered list", icon: ListOrdered, before: "1. ", line: true },
  { label: "Quote", icon: Quote, before: "> ", line: true },
];

/** Wraps the selection (or prefixes the current line) with Markdown syntax and keeps the cursor in place. */
function MarkdownToolbar({
  target,
  value,
  onChange,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
}) {
  const apply = (w: Wrap) => {
    const el = target.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    let next: string;
    let cursor: [number, number];
    if (w.line) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      next = value.slice(0, lineStart) + w.before + value.slice(lineStart);
      cursor = [start + w.before.length, end + w.before.length];
    } else {
      const sel = value.slice(start, end) || w.label.toLowerCase();
      next = value.slice(0, start) + w.before + sel + (w.after ?? "") + value.slice(end);
      cursor = [start + w.before.length, start + w.before.length + sel.length];
    }
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(...cursor);
    });
  };
  return (
    <div role="toolbar" aria-label="Formatting" className="mb-2 flex flex-wrap gap-1">
      {TOOLBAR.map((w) => (
        <button
          key={w.label}
          type="button"
          title={w.label}
          aria-label={w.label}
          onClick={() => apply(w)}
          className="rounded-lg border border-primary/15 p-1.5 text-muted-foreground transition hover:border-primary/40 hover:text-primary"
        >
          <w.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

export function PostEditor({ slug, nav }: { slug?: string | undefined; nav: Nav }) {
  const isNew = !slug;
  const loaded = useAsync(
    () =>
      slug ? api.get<{ post: Post }>(`blog/${encodeURIComponent(slug)}`) : Promise.resolve(null),
    [slug],
  );
  const [post, setPost] = useState<Post | null>(null);
  const [form, setForm] = useState<PostForm>(emptyPostForm());
  const [base, setBase] = useState<PostForm>(emptyPostForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PostAction | null>(null);
  const [acting, setActing] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const clientId = useRef(newClientId());
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  useEffect(() => {
    const p = loaded.data?.post;
    if (p) {
      setPost(p);
      const f = postFormFromApi(p);
      setForm(f);
      setBase(f);
    }
  }, [loaded.data]);
  const dirty = isDirty(form, base);
  const guard = useDirtyGuard(dirty);
  const words = form.body_md.trim() ? form.body_md.trim().split(/\s+/).length : 0;
  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setBanner(null);
    setErrors({});
    try {
      if (isNew) {
        const r = await api.post<{ post: Post }>("blog", {
          client_id: clientId.current,
          slug: form.slug,
          ...postPayload(form),
        });
        setBase(form);
        guard.clear();
        toast.success(`Draft "${r.post.title}" created.`);
        nav({ view: "blog", slug: r.post.slug as string });
      } else {
        const r = await api.put<{ post: Post }>(`blog/${encodeURIComponent(slug!)}`, {
          updated_at: post!.updated_at,
          ...postPayload(form),
        });
        const f = postFormFromApi(r.post);
        setPost(r.post);
        setForm(f);
        setBase(f);
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
    if (!pending || !post) return;
    setActing(true);
    try {
      const r = await api.post<{ post: Post }>(`blog/${encodeURIComponent(slug!)}/action`, {
        action: pending,
        updated_at: post.updated_at,
      });
      setPost(r.post);
      const f = postFormFromApi(r.post);
      setForm(f);
      setBase(f);
      setBanner(null);
      toast.success(`${COPY[pending].label}: done. The database confirmed the change.`);
    } catch (err) {
      setBanner({ kind: "error", text: errorMessage(err) });
    } finally {
      setActing(false);
      setPending(null);
    }
  }

  async function runDelete() {
    if (!post) return;
    setDeleting(true);
    try {
      await api.del(`blog/${encodeURIComponent(post.slug)}`, {
        updated_at: post.updated_at,
        confirm: post.slug,
      });
      guard.clear();
      toast.success(`Post "${post.title}" was deleted permanently.`);
      nav({ view: "blog" });
    } catch (err) {
      setBanner({ kind: "error", text: errorMessage(err) });
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (!isNew && loaded.loading && !post) return <LoadingBlock label="Loading post…" rows={8} />;
  if (!isNew && loaded.error)
    return (
      <Banner kind="error">
        {errorMessage(loaded.error)}{" "}
        <button className="font-bold underline" onClick={() => nav({ view: "blog" })}>
          Back to posts
        </button>
      </Banner>
    );

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            className="text-sm font-semibold text-primary hover:underline"
            onClick={() => nav({ view: "blog" })}
          >
            ← All posts
          </button>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
            {isNew ? "New post" : post?.title}
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

      {post && (
        <section className={card} aria-labelledby="pw-h">
          <h3 id="pw-h" className="text-lg font-extrabold">
            Publishing
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={post.status} />
            <span className="text-muted-foreground">
              Published {fmtDate(post.published_at)} · Updated {fmtDate(post.updated_at)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {actionsFor(post.status).map((a) => (
              <button
                key={a}
                type="button"
                className={COPY[a].destructive ? btnDanger : btnGhost}
                disabled={dirty || saving}
                onClick={() => setPending(a)}
              >
                {COPY[a].label}
              </button>
            ))}
            {post.status !== "published" && (
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
          {post.status === "published" && (
            <p className="mt-2 text-xs text-muted-foreground">
              To delete a published post, unpublish it first.
            </p>
          )}
        </section>
      )}

      <section className={`${card} grid gap-4 sm:grid-cols-2`} aria-labelledby="pb-h">
        <h3 id="pb-h" className="text-lg font-extrabold sm:col-span-2">
          Details
        </h3>
        <Field label="Title *" error={errors.title}>
          <input
            className={inputCls}
            value={form.title}
            maxLength={160}
            onChange={(e) => {
              set("title", e.target.value);
              if (isNew && !slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </Field>
        <Field
          label="Slug *"
          error={errors.slug}
          hint={isNew ? "Permanent once created." : "Slugs cannot be changed."}
        >
          <input
            className={inputCls}
            value={form.slug}
            maxLength={80}
            disabled={!isNew}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value);
            }}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Excerpt (required to publish)" error={errors.excerpt}>
            <textarea
              className={inputCls}
              rows={2}
              maxLength={300}
              value={form.excerpt}
              onChange={(e) => set("excerpt", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Author display name" error={errors.author_name}>
          <input
            className={inputCls}
            maxLength={80}
            value={form.author_name}
            onChange={(e) => set("author_name", e.target.value)}
          />
        </Field>
        <Field label="Tags" error={errors.tags} hint="Comma-separated">
          <input
            className={inputCls}
            value={form.tagsText}
            onChange={(e) => set("tagsText", e.target.value)}
          />
        </Field>
      </section>

      <section className={card} aria-labelledby="pm-h">
        <div className="flex items-center justify-between gap-3">
          <h3 id="pm-h" className="text-lg font-extrabold">
            Body (Markdown)
          </h3>
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
        <p className="mt-1 text-xs text-muted-foreground">
          Supported: headings, **bold**, *italic*, `code`, links, lists, quotes, code blocks. HTML
          and images are not supported and are shown as plain text. {words.toLocaleString()} words.
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className={tab === "preview" ? "hidden lg:block" : ""}>
            <MarkdownToolbar
              target={bodyRef}
              value={form.body_md}
              onChange={(v) => set("body_md", v)}
            />
            <label className="sr-only" htmlFor="post-body">
              Post body in Markdown
            </label>
            <textarea
              ref={bodyRef}
              id="post-body"
              className={`${inputCls} font-mono`}
              rows={22}
              maxLength={100000}
              value={form.body_md}
              onChange={(e) => set("body_md", e.target.value)}
            />
            {errors.body_md && (
              <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
                {errors.body_md}
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
            <MarkdownView source={form.body_md} />
          </div>
        </div>
      </section>

      <section className={`${card} grid gap-4 sm:grid-cols-2`} aria-labelledby="ps-h">
        <h3 id="ps-h" className="text-lg font-extrabold sm:col-span-2">
          SEO
        </h3>
        <Field
          label="SEO title"
          error={errors.seo_title}
          hint={<CharCount value={form.seo_title} max={70} />}
        >
          <input
            className={inputCls}
            maxLength={70}
            value={form.seo_title}
            onChange={(e) => set("seo_title", e.target.value)}
          />
        </Field>
        <Field label="Canonical URL" error={errors.canonical_url}>
          <input
            className={inputCls}
            type="url"
            value={form.canonical_url}
            onChange={(e) => set("canonical_url", e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Meta description"
            error={errors.seo_description}
            hint={<CharCount value={form.seo_description} max={170} />}
          >
            <textarea
              className={inputCls}
              rows={2}
              maxLength={170}
              value={form.seo_description}
              onChange={(e) => set("seo_description", e.target.value)}
            />
          </Field>
        </div>
        <div className="rounded-2xl border border-primary/10 bg-background p-4 text-sm sm:col-span-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Search result preview
          </p>
          <p className="mt-1 truncate text-base font-semibold text-primary">
            {form.seo_title || form.title || "Post title"}
          </p>
          <p className="line-clamp-2 text-muted-foreground">
            {form.seo_description || form.excerpt || "Meta description or excerpt appears here."}
          </p>
        </div>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this post permanently?"
        description={`"${post?.title}" is removed from the database. This cannot be undone. The audit log keeps a record.`}
        confirmLabel="Delete permanently"
        destructive
        busy={deleting}
        confirmText={post?.slug}
        onConfirm={runDelete}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? COPY[pending].title : ""}
        description={pending ? COPY[pending].text : ""}
        confirmLabel={pending ? COPY[pending].label : ""}
        destructive={pending ? COPY[pending].destructive : false}
        busy={acting}
        onConfirm={runAction}
        onCancel={() => setPending(null)}
      />
    </form>
  );
}
