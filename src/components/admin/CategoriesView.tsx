import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AdminApiError, api } from "./client";
import {
  categoryFormFromApi,
  categoryPayload,
  emptyCategoryForm,
  isDirty,
  linesToList,
  slugify,
  type CategoryForm,
} from "./forms";
import type { CategoryRecord } from "./types";
import {
  Banner,
  btnDanger,
  btnGhost,
  btnPrimary,
  CharCount,
  ConfirmDialog,
  EmptyState,
  errorMessage,
  Field,
  inputCls,
  LoadingBlock,
  PageHeader,
  StatusBadge,
  useAsync,
  useDirtyGuard,
  useToast,
} from "./ui";

type Cat = CategoryRecord;

export function CategoriesView({ startNew = false }: { startNew?: boolean }) {
  const list = useAsync(() => api.get<{ items: Cat[] }>("categories"), []);
  const [editing, setEditing] = useState<Cat | "new" | null>(startNew ? "new" : null);
  const [filter, setFilter] = useState("");
  const toast = useToast();
  const items = (list.data?.items ?? []).filter((c) => {
    const f = filter.trim().toLowerCase();
    return !f || c.name.toLowerCase().includes(f) || c.slug.includes(f);
  });
  const newButton = (
    <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
      <Plus className="h-4 w-4" /> New category
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description="Only published categories (and the published tools in them) appear on the public site. A category with tools cannot be deleted, a category with live tools cannot be archived, and subcategories that still contain tools cannot be removed."
        actions={newButton}
      />
      {list.data && list.data.items.length > 0 && (
        <input
          type="search"
          aria-label="Filter categories"
          placeholder="Filter by name or slug"
          className={`${inputCls} max-w-sm`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {list.error ? (
        <Banner kind="error">
          {errorMessage(list.error)}{" "}
          <button className="font-bold underline" onClick={list.reload}>
            Retry
          </button>
        </Banner>
      ) : list.loading && !list.data ? (
        <LoadingBlock label="Loading categories…" />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState
          title="No categories yet"
          text="Create a category before adding tools."
          action={newButton}
        />
      ) : items.length === 0 ? (
        <EmptyState title="No categories match this filter" />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-primary/10 bg-card shadow-card">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Categories</caption>
            <thead className="bg-accent/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Category
                </th>
                <th scope="col" className="px-4 py-3">
                  Tools
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  Index
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/10">
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="font-bold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      /{c.slug} · {c.subcategories.length} subcategories
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.tool_count}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({c.active_tool_count} active)
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">{c.indexing === "index" ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => setEditing(c)}
                      aria-label={`Edit ${c.name}`}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CategoryEditor
          key={editing === "new" ? "new" : editing.slug}
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            toast.success(msg);
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

/** Add/remove subcategories. A subcategory that still has tools shows its count and cannot be removed. */
function SubcategoryEditor({
  value,
  counts,
  onChange,
  error,
}: {
  value: string[];
  counts: Record<string, number>;
  onChange: (v: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const add = () => {
    const s = draft.trim();
    if (!s) return;
    if (value.some((v) => v.toLowerCase() === s.toLowerCase())) {
      setMsg(`"${s}" is already in the list.`);
      return;
    }
    if (s.length > 120) {
      setMsg("Subcategories can be at most 120 characters.");
      return;
    }
    onChange([...value, s]);
    setDraft("");
    setMsg(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="text-sm">
      <span className="mb-1 block font-semibold">Subcategories</span>
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">No subcategories yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Subcategories">
          {value.map((s) => {
            const n = counts[s] ?? 0;
            return (
              <li
                key={s}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-accent/50 py-1 pl-3 pr-1.5"
              >
                <span>{s}</span>
                {n > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
                    {n}
                  </span>
                )}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={n > 0 ? `${s} has ${n} tool(s) and cannot be removed` : `Remove ${s}`}
                  title={n > 0 ? `${n} tool(s) use this subcategory` : `Remove ${s}`}
                  disabled={n > 0}
                  onClick={() => onChange(value.filter((v) => v !== s))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input
          className={inputCls}
          aria-label="New subcategory"
          placeholder="Add a subcategory"
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="button" className={btnGhost} onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
      {(msg || error) && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-destructive">
          {msg ?? error}
        </span>
      )}
    </div>
  );
}

function CategoryEditor({
  category,
  onClose,
  onSaved,
}: {
  category: Cat | null;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const isNew = !category;
  const [form, setForm] = useState<CategoryForm>(
    category ? categoryFormFromApi(category) : emptyCategoryForm(),
  );
  const [base] = useState(form);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirty = isDirty(form, base);
  const guard = useDirtyGuard(dirty);
  const set = <K extends keyof CategoryForm>(k: K, v: CategoryForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => setError(null), [form]);
  const subs = linesToList(form.subcategoriesText);
  const counts = category?.subcategory_counts ?? {};
  const toolCount = Number(category?.tool_count ?? 0);

  const close = () => {
    if (saving) return;
    if (dirty && !window.confirm("Discard your unsaved changes to this category?")) return;
    guard.clear();
    onClose();
  };

  const archiving = form.status === "archived" && base.status !== "archived";
  async function submit() {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      if (isNew) await api.post("categories", { slug: form.slug, ...categoryPayload(form) });
      else
        await api.put(`categories/${encodeURIComponent(form.slug)}`, {
          updated_at: category!.updated_at,
          ...categoryPayload(form),
        });
      guard.clear();
      onSaved(`Category "${form.name}" saved. The database confirmed the change.`);
    } catch (err) {
      if (err instanceof AdminApiError) setErrors(err.fields);
      setError(errorMessage(err));
      setConfirm(false);
    } finally {
      setSaving(false);
    }
  }
  async function runDelete() {
    setSaving(true);
    try {
      await api.del(`categories/${encodeURIComponent(category!.slug)}`, {
        updated_at: category!.updated_at,
        confirm: category!.slug,
      });
      guard.clear();
      onSaved(`Category "${category!.name}" was deleted permanently.`);
    } catch (err) {
      setError(errorMessage(err));
      setDeleteOpen(false);
    } finally {
      setSaving(false);
    }
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (archiving) setConfirm(true);
    else void submit();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-3xl">
        <DialogTitle className="text-xl font-extrabold">
          {isNew ? "New category" : `Edit: ${base.name}`}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {isNew
            ? "The slug becomes part of public URLs and cannot be changed later."
            : `${toolCount} tool(s) in this category.`}
        </DialogDescription>
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          noValidate
          aria-label={isNew ? "New category" : `Edit ${base.name}`}
        >
          {error && <Banner kind="error">{error}</Banner>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *" error={errors.name}>
              <input
                className={inputCls}
                value={form.name}
                maxLength={80}
                onChange={(e) => {
                  set("name", e.target.value);
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
            <Field label="Status" error={errors.status}>
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) => set("status", e.target.value as CategoryForm["status"])}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Search indexing" error={errors.indexing}>
              <select
                className={inputCls}
                value={form.indexing}
                onChange={(e) => set("indexing", e.target.value as CategoryForm["indexing"])}
              >
                <option value="noindex">Off (noindex)</option>
                <option value="index">Allowed (index)</option>
              </select>
            </Field>
            <Field label="Sort order" error={errors.sort_order} hint="Lower numbers come first.">
              <input
                className={inputCls}
                type="number"
                min={0}
                max={100000}
                value={form.sort_order}
                onChange={(e) => set("sort_order", e.target.value)}
              />
            </Field>
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
            <div className="sm:col-span-2">
              <Field label="Description" error={errors.description}>
                <textarea
                  className={inputCls}
                  rows={3}
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <SubcategoryEditor
                value={subs}
                counts={counts}
                error={errors.subcategories}
                onChange={(v) => set("subcategoriesText", v.join("\n"))}
              />
            </div>
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={saving || !dirty}>
              {saving ? "Saving…" : isNew ? "Create category" : "Save changes"}
            </button>
            <button type="button" className={btnGhost} onClick={close} disabled={saving}>
              Cancel
            </button>
            {!isNew && (
              <span className="ml-auto">
                <button
                  type="button"
                  className={btnDanger}
                  disabled={saving || dirty || toolCount > 0}
                  title={toolCount > 0 ? "Move or delete its tools first" : undefined}
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete category
                </button>
              </span>
            )}
          </div>
          {!isNew && toolCount > 0 && (
            <p className="text-xs text-muted-foreground">
              This category has tools, so it cannot be deleted. Move or delete them first.
            </p>
          )}
          <ConfirmDialog
            open={confirm}
            title="Archive this category?"
            description="Archived categories cannot receive new tools. The server will refuse this if any tool in the category is not archived."
            confirmLabel="Archive category"
            destructive
            busy={saving}
            onConfirm={() => void submit()}
            onCancel={() => setConfirm(false)}
          />
          <ConfirmDialog
            open={deleteOpen}
            title="Delete this category permanently?"
            description="The category is removed from the database. This cannot be undone. The audit log keeps a record."
            confirmLabel="Delete permanently"
            destructive
            busy={saving}
            confirmText={category?.slug}
            onConfirm={() => void runDelete()}
            onCancel={() => setDeleteOpen(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
