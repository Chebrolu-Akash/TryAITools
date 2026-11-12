import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useSiteSummary } from "@/lib/catalog/use-site";
import { shortName } from "@/lib/tool-utils";

const nav = [
  { to: "/", label: "AI Tools" },
  { to: "/news", label: "AI News" },
  { to: "/learn", label: "AI Learning Hub" },
  { to: "/gadgets", label: "AI Gadgets" },
  { to: "/guest-articles", label: "Guest Articles" },
  { to: "/blog", label: "Blog" },
  { to: "/agents", label: "AI Agents" },
] as const;

/** Which nav item a path belongs to: tool, category and listing pages are all "AI Tools". */
export function navSection(pathname: string): (typeof nav)[number]["to"] | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || /^\/(tools|categories)(\/|$)/.test(p)) return "/";
  if (/^\/(learn|courses)(\/|$)/.test(p)) return "/learn"; // /courses/* are old Learning Hub URLs
  for (const n of nav) if (n.to !== "/" && (p === n.to || p.startsWith(`${n.to}/`))) return n.to;
  return null;
}

export function Logo() {
  return (
    <a href="/" aria-label="TryAITools home" className="flex items-center gap-2">
      <img
        src="/logo.png?v=2"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-full object-contain"
      />
      <span className="font-display text-xl font-bold tracking-tight">
        Try<span className="text-primary">AI</span>Tools
      </span>
    </a>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // Plain links (pages are pre-built static HTML); highlight the current section like the router links did.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = navSection(pathname);
  const isActive = (to: string) => active === to;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Static and flush with the page at the top; becomes a floating glass bar once scrolled.
  const floating = scrolled || open;
  return (
    <header className="sticky top-0 z-40 -mb-[5.5rem] h-[5.5rem] pt-3 sm:pt-4 page-x">
      <div
        className={`mx-auto max-w-[95rem] rounded-3xl border transition-all duration-300 lg:rounded-full ${
          floating
            ? "border-primary/15 bg-background/80 shadow-[0_12px_40px_-14px_color-mix(in_oklab,var(--primary)_40%,transparent)] backdrop-blur-xl"
            : "border-transparent bg-transparent shadow-none"
        }`}
      >
        {/* Logo left, links centred: the third column mirrors the logo's width so the links sit in the true centre. */}
        <div className="grid h-14 grid-cols-[1fr_auto] items-center gap-3 pl-4 pr-2 sm:h-16 sm:pl-5 lg:pr-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="justify-self-start">
            <Logo />
          </div>
          <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
            {nav.map((n) => (
              <a
                key={n.to}
                href={n.to}
                aria-current={isActive(n.to) ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary xl:px-4 ${isActive(n.to) ? "bg-primary/15 text-primary ring-1 ring-primary/20" : "text-foreground/75"}`}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div aria-hidden className="hidden lg:block" />
          <button
            className="mr-2 justify-self-end lg:hidden"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav
            aria-label="Main"
            className="flex flex-col gap-1 border-t border-primary/10 p-3 lg:hidden"
          >
            {nav.map((n) => (
              <a
                key={n.to}
                href={n.to}
                onClick={() => setOpen(false)}
                aria-current={isActive(n.to) ? "page" : undefined}
                className={`rounded-xl px-3 py-2.5 font-semibold hover:bg-accent${isActive(n.to) ? " bg-primary/15 text-primary" : ""}`}
              >
                {n.label}
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

const explore = [
  { to: "/", label: "AI Tools" },
  { to: "/tools", label: "All AI Tools" },
  { to: "/categories", label: "Categories" },
] as const;

const company = [
  { to: "/about", label: "About" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Use" },
  { to: "/affiliate-disclosure", label: "Affiliate Disclosure" },
  { to: "/how-we-review", label: "How We Review" },
] as const;

type FooterStats = { visitors: number; views: number; since: string | null };

/** Real Google Analytics totals (src/lib/stats.ts), loaded after the page; nothing is shown until GA4 is configured. */
function useFooterStats() {
  const [stats, setStats] = useState<FooterStats | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stats?: FooterStats | null } | null) => live && setStats(d?.stats ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return stats;
}

export function Footer() {
  const { categories } = useSiteSummary();
  const stats = useFooterStats();
  return (
    <footer className="mt-24 border-t border-border bg-secondary">
      <div className="page-container grid gap-10 py-14 md:grid-cols-12">
        <div className="space-y-3 md:col-span-4">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Discover the best AI tools for every task, organized by category. Free to browse,
            always.
          </p>
        </div>
        <nav aria-label="Explore" className="md:col-span-2">
          <h4 className="mb-4 text-sm font-semibold">Explore</h4>
          <ul className="space-y-2">
            {explore.map((l) => (
              <li key={l.to}>
                <a href={l.to} className="footer-link">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Company" className="md:col-span-2">
          <h4 className="mb-4 text-sm font-semibold">Company</h4>
          <ul className="space-y-2">
            {company.map((l) => (
              <li key={l.to}>
                <a href={l.to} className="footer-link">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Categories" className="md:col-span-4">
          <h4 className="mb-4 text-sm font-semibold">Categories</h4>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <a href={`/categories/${c.slug}`} className="footer-link">
                  {shortName(c.name)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="page-container flex flex-col items-center justify-between gap-3 py-5 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} TryAITools. All rights reserved.</p>
          {stats && (
            <p className="flex items-center gap-4" title="Source: Google Analytics">
              <span>
                <strong className="font-semibold text-foreground">
                  {stats.visitors.toLocaleString("en-US")}
                </strong>{" "}
                Visitors
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {stats.views.toLocaleString("en-US")}
                </strong>{" "}
                Page Views
              </span>
            </p>
          )}
          <p className="text-center sm:text-right">
            Some links are affiliate links. Product names and logos belong to their respective
            owners.
          </p>
        </div>
      </div>
    </footer>
  );
}

/** `flush` lets the first section (e.g. the home hero) extend behind the header instead of starting below it. */
export function Page({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={`flex-1 ${flush ? "" : "pt-[5.5rem]"}`}>{children}</main>
      <Footer />
    </div>
  );
}
