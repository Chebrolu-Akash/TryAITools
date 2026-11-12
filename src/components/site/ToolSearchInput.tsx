import { Search } from "lucide-react";
import { MAX_QUERY } from "@/lib/catalog/views";

/** The search box used on /tools and on category pages (same look, same length limit). */
export function ToolSearchInput({
  value,
  onChange,
  label = "Search AI tools",
  placeholder = "Search by name or use case…",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <div className="mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-background p-2 shadow-soft">
      <Search className="ml-3 h-5 w-5 text-muted-foreground" />
      <input
        enterKeyHint="search"
        value={value}
        maxLength={MAX_QUERY}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="flex-1 bg-transparent px-2 py-2 outline-none"
      />
    </div>
  );
}
