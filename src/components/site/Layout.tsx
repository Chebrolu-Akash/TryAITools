import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { categories, shortName } from "@/lib/tools";

const nav = [
  { to: "/", label: "Home" },
  { to: "/tools", label: "AI Tools" },
  { to: "/categories", label: "Categories" },
  { to: "/about", label: "About" },
] as const;

export function Logo() {
  return (
    <Link to="/" aria-label="TryAITools home" className="flex items-center gap-2">
      <img src="/logo.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl shadow-soft" />
      <span className="font-display text-xl font-bold tracking-tight">
        Try<span className="text-primary">AI</span>Tools
      </span>
    </Link>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary"
              activeProps={{ className: "text-primary" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <Link
          to="/tools"
          className="hidden rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition hover:opacity-90 md:inline-flex"
        >
          Explore Tools
        </Link>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 font-medium hover:bg-accent">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

const explore = [
  { to: "/", label: "Home" },
  { to: "/tools", label: "All AI Tools" },
  { to: "/categories", label: "Categories" },
] as const;

const company = [
  { to: "/about", label: "About" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Use" },
  { to: "/affiliate-disclosure", label: "Affiliate Disclosure" },
] as const;

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-secondary">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-12">
        <div className="space-y-3 md:col-span-4">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Discover the best AI tools for every task, organized by category. Free to browse, always.
          </p>
        </div>
        <nav aria-label="Explore" className="md:col-span-2">
          <h4 className="mb-4 text-sm font-semibold">Explore</h4>
          <ul className="space-y-2">
            {explore.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="text-sm text-muted-foreground hover:text-primary">{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Company" className="md:col-span-2">
          <h4 className="mb-4 text-sm font-semibold">Company</h4>
          <ul className="space-y-2">
            {company.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="text-sm text-muted-foreground hover:text-primary">{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Categories" className="md:col-span-4">
          <h4 className="mb-4 text-sm font-semibold">Categories</h4>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link to="/categories/$slug" params={{ slug: c.slug }} className="text-sm text-muted-foreground hover:text-primary">
                  {shortName(c.name)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} TryAITools. All rights reserved.</p>
          <p className="text-center sm:text-right">
            Some links are affiliate links. Product names and logos belong to their respective owners.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
