import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

// Turns the parsed Markdown tree into React elements. No raw-HTML injection API is used anywhere:
// every string is a React text child (escaped by React) and every href already passed safeHref().

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "strong":
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.c)}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {n.v}
          </code>
        );
      case "link":
        return n.external ? (
          <a
            key={i}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="font-semibold text-primary underline underline-offset-2"
          >
            {renderInline(n.c)}
          </a>
        ) : (
          <a
            key={i}
            href={n.href}
            className="font-semibold text-primary underline underline-offset-2"
          >
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "h": {
      const cls = "mt-6 mb-2 font-extrabold tracking-tight text-foreground";
      if (b.level === 2)
        return (
          <h2 key={i} className={`${cls} text-2xl`}>
            {renderInline(b.c)}
          </h2>
        );
      if (b.level === 3)
        return (
          <h3 key={i} className={`${cls} text-xl`}>
            {renderInline(b.c)}
          </h3>
        );
      if (b.level === 4)
        return (
          <h4 key={i} className={`${cls} text-lg`}>
            {renderInline(b.c)}
          </h4>
        );
      if (b.level === 5)
        return (
          <h5 key={i} className={`${cls} text-base`}>
            {renderInline(b.c)}
          </h5>
        );
      return (
        <h6 key={i} className={`${cls} text-base`}>
          {renderInline(b.c)}
        </h6>
      );
    }
    case "p":
      return (
        <p key={i} className="my-3 leading-7 text-foreground/85">
          {renderInline(b.c)}
        </p>
      );
    case "ul":
      return (
        <ul key={i} className="my-3 list-disc space-y-1 pl-6 text-foreground/85">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} className="my-3 list-decimal space-y-1 pl-6 text-foreground/85">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote
          key={i}
          className="my-3 border-l-4 border-primary/30 pl-4 italic text-foreground/75"
        >
          {renderInline(b.c)}
        </blockquote>
      );
    case "code":
      return (
        <pre key={i} className="my-3 overflow-x-auto rounded-xl bg-muted p-3 font-mono text-sm">
          <code>{b.v}</code>
        </pre>
      );
    case "hr":
      return <hr key={i} className="my-6 border-primary/15" />;
  }
}

export function MarkdownView({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0)
    return <p className={`text-sm text-muted-foreground ${className}`}>Nothing to preview yet.</p>;
  return <div className={className}>{blocks.map(renderBlock)}</div>;
}
