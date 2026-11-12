import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  BookOpen,
  GraduationCap,
  Cpu,
  FileText,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Newspaper,
  Wrench,
  X,
} from "lucide-react";
import { AdminApiError, api } from "./client";
import { BlogList, PostEditor } from "./BlogView";
import { CategoriesView } from "./CategoriesView";
import { Dashboard } from "./Dashboard";
import { NewsView } from "./NewsView";
import { SectionEditor, SectionList } from "./SectionsView";
import { ToolEditor } from "./ToolEditor";
import { ToolsList } from "./ToolsList";
import { Banner, DirtyProvider, errorMessage, ToastProvider, useAsync } from "./ui";

export type AdminSearch = {
  view?:
    | "tools"
    | "categories"
    | "blog"
    | "courses"
    | "tutorials"
    | "gadgets"
    | "guest-articles"
    | "news";
  slug?: string;
  new?: "1";
  status?: string;
  review?: "1";
};
export type Nav = (s: AdminSearch) => void;
type Session = { email: string; mode?: "access" | "local-dev" };

const NAV: {
  view: AdminSearch["view"] | undefined;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { view: undefined, label: "Dashboard", icon: LayoutDashboard },
  { view: "tools", label: "Tools", icon: Wrench },
  { view: "categories", label: "Categories", icon: FolderTree },
  { view: "courses", label: "Courses & books", icon: BookOpen },
  { view: "tutorials", label: "Tutorials", icon: GraduationCap },
  { view: "gadgets", label: "Gadgets", icon: Cpu },
  { view: "guest-articles", label: "Guest articles", icon: Megaphone },
  { view: "blog", label: "Blog", icon: FileText },
  { view: "news", label: "AI News", icon: Newspaper },
];

export function AdminApp({ search, nav: rawNav }: { search: AdminSearch; nav: Nav }) {
  const session = useAsync(() => api.get<Session>("session"), []);
  const dirty = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const prev = document.title;
    document.title = "Admin | TryAITools";
    return () => void (document.title = prev);
  }, []);

  // Every in-app navigation asks first when an editor has unsaved changes.
  const nav: Nav = (s) => {
    if (dirty.current && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    dirty.current = false;
    setMenuOpen(false);
    rawNav(s);
  };

  if (session.loading && !session.data)
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Checking your sign-in…
        </p>
      </main>
    );
  if (session.error || !session.data) {
    const status = session.error instanceof AdminApiError ? session.error.status : 0;
    return (
      <main className="mx-auto max-w-lg px-4 py-24">
        <Banner kind="error">
          {status === 401
            ? "You are not signed in. Open this page through Cloudflare Access."
            : status === 403
              ? "This account is not on the admin allowlist."
              : status === 503
                ? "Admin access is not configured or cannot be verified right now."
                : errorMessage(session.error)}
        </Banner>
      </main>
    );
  }

  const view = search.view;
  const localDev = session.data.mode === "local-dev";
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <span className="text-lg font-extrabold tracking-tight">
          TryAITools <span className="text-primary">Admin</span>
        </span>
        <button
          type="button"
          className="rounded-full p-1.5 lg:hidden"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav aria-label="Admin" className="flex-1 space-y-1 px-3">
        {NAV.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <button
              key={label}
              type="button"
              onClick={() => nav(v ? { view: v } : {})}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-primary/10 px-5 py-4 text-xs">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-bold text-amber-700 dark:text-amber-300">
            {localDev ? "Local database" : "Preview database"}
          </span>
          {localDev && (
            <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 font-bold text-destructive">
              Local dev sign-in
            </span>
          )}
        </div>
        <div className="text-muted-foreground">
          Signed in as
          <div className="truncate font-semibold text-foreground" title={session.data.email}>
            {session.data.email}
          </div>
        </div>
        {!localDev && (
          <a
            href="/cdn-cgi/access/logout"
            className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </a>
        )}
      </div>
    </div>
  );

  return (
    <ToastProvider>
      <DirtyProvider value={dirty}>
        <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
          <aside className="hidden border-r border-primary/10 bg-card lg:sticky lg:top-0 lg:block lg:h-screen">
            {sidebar}
          </aside>
          {menuOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                aria-label="Close menu"
                className="absolute inset-0 bg-foreground/30"
                onClick={() => setMenuOpen(false)}
              />
              <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-card shadow-card">
                {sidebar}
              </aside>
            </div>
          )}
          <div className="min-w-0">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-primary/10 bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
              <button
                type="button"
                className="rounded-full p-1.5"
                aria-label="Open menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="font-extrabold tracking-tight">
                TryAITools <span className="text-primary">Admin</span>
              </span>
              {localDev && (
                <span className="ml-auto rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
                  Local dev
                </span>
              )}
            </header>
            <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
              {!view && <Dashboard nav={nav} />}
              {view === "tools" &&
                (search.slug || search.new ? (
                  <ToolEditor key={search.slug ?? "new"} slug={search.slug} nav={nav} />
                ) : (
                  <ToolsList
                    key={`${search.status ?? ""}|${search.review ?? ""}`}
                    nav={nav}
                    initial={{ status: search.status, review: search.review }}
                  />
                ))}
              {view === "categories" && <CategoriesView startNew={search.new === "1"} />}
              {view === "news" && <NewsView />}
              {view === "blog" &&
                (search.slug || search.new ? (
                  <PostEditor key={search.slug ?? "new"} slug={search.slug} nav={nav} />
                ) : (
                  <BlogList nav={nav} />
                ))}
              {(view === "courses" ||
                view === "tutorials" ||
                view === "gadgets" ||
                view === "guest-articles") &&
                (search.slug || search.new ? (
                  <SectionEditor
                    key={`${view}|${search.slug ?? "new"}`}
                    view={view}
                    slug={search.slug}
                    nav={nav}
                  />
                ) : (
                  <SectionList key={view} view={view} nav={nav} />
                ))}
            </main>
          </div>
        </div>
      </DirtyProvider>
    </ToastProvider>
  );
}
