import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminApiError } from "./client";

export const inputCls =
  "w-full rounded-xl border border-primary/15 bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-primary/20 bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-background px-4 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const card = "rounded-3xl border border-primary/10 bg-card p-5 shadow-card sm:p-6";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-foreground">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

export function Banner({
  kind,
  children,
  onClose,
}: {
  kind: "success" | "error" | "info";
  children: ReactNode;
  onClose?: () => void;
}) {
  const tone =
    kind === "success"
      ? "border-green-600/30 bg-green-600/10 text-green-800 dark:text-green-300"
      : kind === "error"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-primary/20 bg-accent/60 text-foreground";
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-medium ${tone}`}
    >
      <div>{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 font-bold">
          ×
        </button>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  published: "bg-green-600/15 text-green-700 dark:text-green-300",
  draft: "bg-muted text-muted-foreground",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  archived: "bg-destructive/10 text-destructive",
};
export const StatusBadge = ({ status }: { status: string }) => (
  <span
    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_TONE[status] ?? STATUS_TONE.draft}`}
  >
    {status}
  </span>
);

/**
 * Confirmation before any state change. With `confirmText`, the owner must type that exact text (the slug) before the
 * confirm button enables; the server checks the same text again, so this is not only a client-side safeguard.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  confirmText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const blocked = !!confirmText && typed.trim() !== confirmText;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText && (
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">
              Type <code className="rounded bg-muted px-1">{confirmText}</code> to confirm
            </span>
            <input
              className={inputCls}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || blocked}
            onClick={(e) => {
              e.preventDefault(); // keep the dialog open until the server answers
              onConfirm();
            }}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const errorMessage = (e: unknown) =>
  e instanceof AdminApiError ? e.message : "Something went wrong. Nothing was saved.";

/** Loads data on mount / when deps change; ignores stale responses. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error) => n === seq.current && setState({ data: null, error, loading: false }),
    );
    // The caller supplies the dependency list on purpose (it is the point of this hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { ...state, reload: run };
}

/** Warns before leaving the page with unsaved edits. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const fmtDate = (iso: unknown) => {
  if (typeof iso !== "string") return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

// ---------------------------------------------------------------- layout helpers

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`${card} flex flex-col items-center gap-2 py-10 text-center`}>
      <p className="text-base font-bold text-foreground">{title}</p>
      {text && <p className="max-w-md text-sm text-muted-foreground">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Placeholder rows while a list loads (announced once to screen readers). */
export function LoadingBlock({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className={`${card} space-y-3`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-5 animate-pulse rounded-full bg-muted" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** "12 / 70" counter for length-limited SEO fields; turns red past the limit. */
export const CharCount = ({ value, max }: { value: string; max: number }) => (
  <span className={value.length > max ? "font-semibold text-destructive" : undefined}>
    {value.length} / {max}
  </span>
);

// ---------------------------------------------------------------- toasts

type Toast = { id: number; kind: "success" | "error"; text: string };
type ToastApi = { success: (text: string) => void; error: (text: string) => void };
const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {} });
export const useToast = () => useContext(ToastContext);

/** Short-lived confirmations ("Saved") in a polite live region; errors also stay inline next to the form. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = ++next.current;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (t) => push("success", t), error: (t) => push("error", t) }),
    [push],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-card ${
              t.kind === "success"
                ? "border-green-600/30 bg-card text-green-800 dark:text-green-300"
                : "border-destructive/40 bg-card text-destructive"
            }`}
          >
            <span>{t.text}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="shrink-0 font-bold"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------- unsaved-changes guard for in-app navigation

type DirtyRegistry = { current: boolean };
const DirtyContext = createContext<DirtyRegistry>({ current: false });
export const DirtyProvider = DirtyContext.Provider;

/**
 * Registers an editor's unsaved state with the admin shell, which asks before navigating away. Call `clear()`
 * right before navigating after a successful save (the state update has not rendered yet at that point).
 */
export function useDirtyGuard(dirty: boolean) {
  const reg = useContext(DirtyContext);
  useUnsavedWarning(dirty);
  useEffect(() => {
    reg.current = dirty;
    return () => {
      reg.current = false;
    };
  }, [dirty, reg]);
  return { clear: () => void (reg.current = false) };
}
