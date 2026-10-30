import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminApiError, api } from "./client";
import {
  emptyToolForm,
  isDirty,
  newClientId,
  slugify,
  toolFormFromApi,
  toolPayload,
  type ToolForm,
} from "./forms";
import {
  Banner,
  btnDanger,
  btnGhost,
  btnPrimary,
  card,
  CharCount,
  ConfirmDialog,
  errorMessage,
  Field,
  fmtDate,
  inputCls,
  LoadingBlock,
  StatusBadge,
  useAsync,
  useDirtyGuard,
  useToast,
} from "./ui";
import type { Nav } from "./AdminApp";
import type { ToolRecord } from "./types";

type Tool = ToolRecord;
type Cat = { id: string; name: string; subcategories: string[]; status: string };
type Action =
  | "publish"
  | "unpublish"
  | "send_to_review"
  | "archive"
  | "restore"
  | "flag_needs_review"
  | "clear_needs_review";

const ACTION_COPY: Record<
  Action,
  { label: string; title: string; text: string; destructive?: boolean }
> = {
  publish: {
    label: "Publish",
    title: "Publish this tool?",
    text: "It appears on the public site (tools list, its category and its own page) on the next page load, as long as its category is published. Indexing stays as you set it.",
  },
  unpublish: {
    label: "Unpublish",
    title: "Unpublish this tool?",
    text: "It returns to draft and indexing is switched off.",
    destructive: true,
  },
  send_to_review: {
    label: "Send to review",
    title: "Send to review?",
    text: "Marks the draft as ready for a final check.",
  },
  archive: {
    label: "Archive",
    title: "Archive this tool?",
    text: "It is hidden everywhere and indexing is switched off. You can restore it later. Nothing is deleted.",
    destructive: true,
  },
  restore: {
    label: "Restore to draft",
    title: "Restore this tool?",
    text: "It returns as a draft; it is not published automatically.",
  },
  flag_needs_review: {
    label: "Flag: needs review",
    title: "Flag as needing review?",
    text: "A published tool will be moved back to draft and indexing switched off until the flag is cleared.",
    destructive: true,
  },
  clear_needs_review: {
    label: "Clear review flag",
    title: "Clear the review flag?",
    text: "Confirm that you have checked this tool's name, website and category.",
  },
};

const available = (t: Tool): Action[] => {
  const out: Action[] = [];
  if (t.status === "draft") out.push("send_to_review", "publish");
  if (t.status === "review") out.push("publish");
  if (t.status === "published") out.push("unpublish");
  if (t.status === "archived") out.push("restore");
  else out.push("archive");
  out.push(t.needs_review ? "clear_needs_review" : "flag_needs_review");
  return out;
};

export function ToolEditor({ slug, nav }: { slug?: string | undefined; nav: Nav }) {
  const isNew = !slug;
  const cats = useAsync(() => api.get<{ items: Cat[] }>("categories"), []);
  const loaded = useAsync(
    () =>
      slug ? api.get<{ tool: Tool }>(`tools/${encodeURIComponent(slug)}`) : Promise.resolve(null),
    [slug],
  );
  const [tool, setTool] = useState<Tool | null>(null);
  const [form, setForm] = useState<ToolForm>(emptyToolForm());
  const [base, setBase] = useState<ToolForm>(emptyToolForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [acting, setActing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const clientId = useRef(newClientId()); // one id per "new tool" form => retries cannot create duplicates
  const toast = useToast();

  useEffect(() => {
    const t = loaded.data?.tool;
    if (t) {
      setTool(t);
      const f = toolFormFromApi(t);
      setForm(f);
      setBase(f);
    }
  }, [loaded.data]);
  useEffect(() => {
    if (isNew && cats.data && !form.category_id) {
      const first = cats.data.items.find((c) => c.status !== "archived");
      if (first) setForm((f) => ({ ...f, category_id: first.id }));
    }
  }, [isNew, cats.data, form.category_id]);

  const dirty = isDirty(form, base);
  const guard = useDirtyGuard(dirty);
  const set = <K extends keyof ToolForm>(k: K, v: ToolForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const cat = cats.data?.items.find((c) => c.id === form.category_id);
  const subs = Array.from(
    new Set([...(cat?.subcategories ?? []), ...(form.subcategory ? [form.subcategory] : [])]),
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setBanner(null);
    setErrors({});
    try {
      if (isNew) {
        const r = await api.post<{ tool: Tool; created: boolean }>("tools", {
          client_id: clientId.current,
          slug: form.slug,
          ...toolPayload(form),
        });
        setBase(form);
        guard.clear();
        toast.success(`Draft "${r.tool.name}" created.`);
        nav({ view: "tools", slug: r.tool.slug as string });
      } else {
        const r = await api.put<{ tool: Tool }>(`tools/${encodeURIComponent(slug!)}`, {
          updated_at: tool!.updated_at,
          ...toolPayload(form),
        });
        const f = toolFormFromApi(r.tool);
        setTool(r.tool);
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
    if (!pending || !tool) return;
    setActing(true);
    try {
      const r = await api.post<{ tool: Tool }>(`tools/${encodeURIComponent(slug!)}/action`, {
        action: pending,
        updated_at: tool.updated_at,
      });
      const f = toolFormFromApi(r.tool);
      setTool(r.tool);
      setForm(f);
      setBase(f);
      setBanner(null);
      toast.success(`${ACTION_COPY[pending].label}: done. The database confirmed the change.`);
    } catch (err) {
      setBanner({ kind: "error", text: errorMessage(err) });
    } finally {
      setActing(false);
      setPending(null);
    }
  }

  async function runDelete() {
    if (!tool) return;
    setDeleting(true);
    try {
      await api.del(`tools/${encodeURIComponent(tool.slug)}`, {
        updated_at: tool.updated_at,
        confirm: tool.slug,
      });
      guard.clear();
      toast.success(`Tool "${tool.name}" was deleted permanently.`);
      nav({ view: "tools" });
    } catch (err) {
      setBanner({ kind: "error", text: errorMessage(err) });
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (!isNew && loaded.loading && !tool) return <LoadingBlock label="Loading tool…" rows={8} />;
  if (!isNew && loaded.error)
    return (
      <Banner kind="error">
        {errorMessage(loaded.error)}{" "}
        <button className="font-bold underline" onClick={() => nav({ view: "tools" })}>
          Back to tools
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
            onClick={() => nav({ view: "tools" })}
          >
            ← All tools
          </button>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
            {isNew ? "New tool" : tool?.name}
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

      {tool && (
        <section className={card} aria-labelledby="wf-h">
          <h3 id="wf-h" className="text-lg font-extrabold">
            Workflow
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={tool.status} />
            {tool.needs_review ? (
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                Needs review{tool.import_issue ? `: ${tool.import_issue}` : ""}
              </span>
            ) : null}
            <span className="text-muted-foreground">
              Indexing: {tool.indexing === "index" ? "allowed" : "off"} · Updated{" "}
              {fmtDate(tool.updated_at)} · Source: {tool.content_source}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {available(tool).map((a) => (
              <button
                key={a}
                type="button"
                className={ACTION_COPY[a].destructive ? btnDanger : btnGhost}
                disabled={dirty || saving}
                onClick={() => setPending(a)}
              >
                {ACTION_COPY[a].label}
              </button>
            ))}
            {tool.status === "archived" && (
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
          {tool.status !== "archived" && (
            <p className="mt-2 text-xs text-muted-foreground">
              To delete a tool permanently, archive it first.
            </p>
          )}
          {dirty && (
            <p className="mt-2 text-xs text-muted-foreground">
              Save or discard your edits before changing the workflow state.
            </p>
          )}
        </section>
      )}

      <section className={`${card} grid gap-4 sm:grid-cols-2`} aria-labelledby="basic-h">
        <h3 id="basic-h" className="text-lg font-extrabold sm:col-span-2">
          Basics
        </h3>
        <Field label="Name *" error={errors.name}>
          <input
            className={inputCls}
            value={form.name}
            maxLength={120}
            required
            onChange={(e) => {
              set("name", e.target.value);
              if (isNew && !slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </Field>
        <Field
          label="URL slug *"
          error={errors.slug}
          hint={
            isNew
              ? "Lowercase letters, numbers and hyphens. Cannot be changed later."
              : "Slugs are permanent in this stage."
          }
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
        <Field label="Display name" error={errors.display_name}>
          <input
            className={inputCls}
            value={form.display_name}
            maxLength={120}
            onChange={(e) => set("display_name", e.target.value)}
          />
        </Field>
        <Field
          label="Official website"
          error={errors.url}
          hint="https:// address. Required before publishing."
        >
          <input
            className={inputCls}
            type="url"
            inputMode="url"
            value={form.url}
            maxLength={2048}
            onChange={(e) => set("url", e.target.value)}
          />
        </Field>
        <Field label="Category *" error={errors.category_id}>
          <select
            className={inputCls}
            value={form.category_id}
            onChange={(e) => {
              set("category_id", e.target.value);
              set("subcategory", "");
            }}
          >
            {!cats.data && <option value="">Loading…</option>}
            {cats.data?.items.map((c) => (
              <option
                key={c.id}
                value={c.id}
                disabled={c.status === "archived" && c.id !== base.category_id}
              >
                {c.name}
                {c.status === "archived" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subcategory" error={errors.subcategory}>
          <select
            className={inputCls}
            value={form.subcategory}
            onChange={(e) => set("subcategory", e.target.value)}
          >
            <option value="">None</option>
            {subs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags" error={errors.tags} hint="Comma-separated">
          <input
            className={inputCls}
            value={form.tagsText}
            onChange={(e) => set("tagsText", e.target.value)}
          />
        </Field>
        <Field label="Logo image URL" error={errors.logo_url}>
          <input
            className={inputCls}
            type="url"
            value={form.logo_url}
            onChange={(e) => set("logo_url", e.target.value)}
          />
        </Field>
      </section>

      <section className={`${card} grid gap-4`} aria-labelledby="content-h">
        <h3 id="content-h" className="text-lg font-extrabold">
          Content (plain text, shown escaped)
        </h3>
        <Field label="One-line description" error={errors.tagline}>
          <input
            className={inputCls}
            value={form.tagline}
            maxLength={200}
            onChange={(e) => set("tagline", e.target.value)}
          />
        </Field>
        <Field label="Overview" error={errors.overview}>
          <textarea
            className={inputCls}
            rows={5}
            maxLength={4000}
            value={form.overview}
            onChange={(e) => set("overview", e.target.value)}
          />
        </Field>
        <Field label="Best for" error={errors.best_for}>
          <input
            className={inputCls}
            value={form.best_for}
            maxLength={300}
            onChange={(e) => set("best_for", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Key features"
            error={errors.features}
            hint="One per line. Only facts you have verified."
          >
            <textarea
              className={inputCls}
              rows={5}
              value={form.featuresText}
              onChange={(e) => set("featuresText", e.target.value)}
            />
          </Field>
          <Field label="Pros" error={errors.pros} hint="One per line">
            <textarea
              className={inputCls}
              rows={5}
              value={form.prosText}
              onChange={(e) => set("prosText", e.target.value)}
            />
          </Field>
          <Field label="Limitations" error={errors.limits} hint="One per line">
            <textarea
              className={inputCls}
              rows={5}
              value={form.limitsText}
              onChange={(e) => set("limitsText", e.target.value)}
            />
          </Field>
          <Field label="How to use (steps)" error={errors.steps} hint="One per line">
            <textarea
              className={inputCls}
              rows={5}
              value={form.stepsText}
              onChange={(e) => set("stepsText", e.target.value)}
            />
          </Field>
          <Field label="Tips" error={errors.tips} hint="One per line">
            <textarea
              className={inputCls}
              rows={4}
              value={form.tipsText}
              onChange={(e) => set("tipsText", e.target.value)}
            />
          </Field>
          <Field label="Platforms" error={errors.platforms} hint="Comma-separated, e.g. Web, iOS">
            <input
              className={inputCls}
              value={form.platformsText}
              onChange={(e) => set("platformsText", e.target.value)}
            />
          </Field>
          <Field
            label="Pricing note"
            error={errors.pricing_note}
            hint="Only what you have verified"
          >
            <input
              className={inputCls}
              value={form.pricing_note}
              maxLength={300}
              onChange={(e) => set("pricing_note", e.target.value)}
            />
          </Field>
          <Field
            label="Pricing source / verification"
            error={errors.pricing_source}
            hint="Where and when you checked"
          >
            <input
              className={inputCls}
              value={form.pricing_source}
              maxLength={300}
              onChange={(e) => set("pricing_source", e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className={`${card} grid gap-4 sm:grid-cols-2`} aria-labelledby="seo-h">
        <h3 id="seo-h" className="text-lg font-extrabold sm:col-span-2">
          SEO and indexing
        </h3>
        <Field
          label="SEO title"
          error={errors.seo_title}
          hint={<CharCount value={form.seo_title} max={70} />}
        >
          <input
            className={inputCls}
            value={form.seo_title}
            maxLength={70}
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
        <Field label="Social image URL" error={errors.og_image_url}>
          <input
            className={inputCls}
            type="url"
            value={form.og_image_url}
            onChange={(e) => set("og_image_url", e.target.value)}
          />
        </Field>
        <Field
          label="Search indexing"
          error={errors.indexing}
          hint="Only published tools can be set to allowed."
        >
          <select
            className={inputCls}
            value={form.indexing}
            onChange={(e) => set("indexing", e.target.value as ToolForm["indexing"])}
          >
            <option value="noindex">Off (noindex)</option>
            <option value="index" disabled={isNew || tool?.status !== "published"}>
              Allowed (index)
            </option>
          </select>
        </Field>
      </section>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACTION_COPY[pending].title : ""}
        description={pending ? `${tool?.name}: ${ACTION_COPY[pending].text}` : ""}
        confirmLabel={pending ? ACTION_COPY[pending].label : ""}
        destructive={pending ? ACTION_COPY[pending].destructive : false}
        busy={acting}
        onConfirm={runAction}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete this tool permanently?"
        description={`"${tool?.name}" and its old-slug redirects are removed from the database. This cannot be undone. The audit log keeps a record of the deletion.`}
        confirmLabel="Delete permanently"
        destructive
        busy={deleting}
        confirmText={tool?.slug}
        onConfirm={runDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </form>
  );
}
