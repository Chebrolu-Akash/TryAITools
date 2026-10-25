import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

export function CopyPrompt({ prompt }: { prompt: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (next: "copied" | "failed") => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2200);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      flash("copied");
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      try {
        const ta = document.createElement("textarea");
        ta.value = prompt;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        flash(ok ? "copied" : "failed");
      } catch {
        flash("failed");
      }
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-primary/10 bg-accent/60 px-4 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wide text-primary">Ready-to-paste prompt</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {state === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {state === "copied" ? "Copied!" : state === "failed" ? "Press Ctrl+C" : "Copy Prompt"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-[13px] leading-6 text-foreground/85 sm:text-sm">{prompt}</pre>
      <span role="status" aria-live="polite" className="sr-only">{state === "copied" ? "Prompt copied to clipboard" : ""}</span>
    </div>
  );
}
