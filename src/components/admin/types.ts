// Shapes of the records returned by /api/admin. Extra columns are allowed (index signature) but the fields the
// screens rely on are typed, so the UI does not need `any`.
export type ToolRecord = {
  id: string;
  slug: string;
  name: string;
  url: string | null;
  category_id: string;
  category_name?: string;
  subcategory: string | null;
  status: "draft" | "review" | "published" | "archived";
  indexing: "index" | "noindex";
  needs_review: number;
  import_issue: string | null;
  content_source: string;
  updated_at: string;
  [column: string]: unknown;
};

export type CategoryRecord = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  indexing: "index" | "noindex";
  subcategories: string[];
  tool_count?: number;
  active_tool_count?: number;
  subcategory_counts?: Record<string, number>;
  updated_at: string;
  [column: string]: unknown;
};

export type PostRecord = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  updated_at: string;
  [column: string]: unknown;
};
