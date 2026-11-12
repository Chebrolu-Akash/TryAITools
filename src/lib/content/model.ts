// Public shapes of the content sections (AI Courses, AI Gadgets, Guest Articles, Blog). Only fields a visitor may see:
// guest-article contributor emails and payment details never leave the database (see reader.ts).

export const CONTENT_SECTIONS = [
  "courses",
  "tutorials",
  "gadgets",
  "guest-articles",
  "blog",
] as const;
export type ContentSection = (typeof CONTENT_SECTIONS)[number];
export const isContentSection = (v: string): v is ContentSection =>
  (CONTENT_SECTIONS as readonly string[]).includes(v);

export type PublicImage = { url: string; alt: string; width: number | null; height: number | null };

type Base = {
  slug: string;
  title: string;
  image: PublicImage | null;
  publishedAt: string;
  updatedAt: string;
};

export type CourseCard = Base & {
  kind: "course" | "book";
  provider: string | null;
  summary: string | null;
  level: "beginner" | "intermediate" | "advanced" | "all";
  format: string | null;
  duration: string | null;
  price: string | null;
  isFree: boolean;
  url: string | null;
  topics: string[];
  featured: boolean;
};
export type TutorialCard = Base & {
  author: string | null;
  summary: string | null;
  difficulty: "beginner" | "intermediate" | "advanced";
  format: string | null;
  duration: string | null;
  url: string | null;
  isAffiliate: boolean;
  isFree: boolean;
  topics: string[];
  featured: boolean;
};
export type GadgetCard = Base & {
  brand: string | null;
  type: string;
  summary: string | null;
  features: string[];
  price: string | null;
  retailer: string | null;
  url: string | null;
  otherRetailers: { name: string; url: string }[];
  featured: boolean;
};
export type GuestCard = Base & {
  excerpt: string | null;
  topic: string | null;
  contributor: string;
  sponsor: string;
  sponsorLabel: string;
};
export type PostCard = Base & {
  excerpt: string | null;
  author: string | null;
  tags: string[];
  minutes: number;
};

/** The detail page adds the long text and the page's SEO fields. */
type Detail = {
  body: string;
  indexable: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Another URL this page is a copy of (guest articles and blog posts), or null for itself. */
  canonical: string | null;
};
export type CourseDetail = CourseCard & Detail;
export type TutorialDetail = TutorialCard & Detail;
export type GadgetDetail = GadgetCard & Detail;
export type GuestDetail = GuestCard & Detail & { sponsorUrl: string | null };
export type PostDetail = PostCard & Detail;

export type ContentList = {
  courses: CourseCard[];
  tutorials: TutorialCard[];
  gadgets: GadgetCard[];
  "guest-articles": GuestCard[];
  blog: PostCard[];
};
export type ContentDetail = {
  courses: CourseDetail;
  tutorials: TutorialDetail;
  gadgets: GadgetDetail;
  "guest-articles": GuestDetail;
  blog: PostDetail;
};

export const GADGET_TYPES: Record<string, string> = {
  "smart-speakers": "Smart speakers",
  wearables: "Wearables",
  cameras: "Cameras",
  translators: "Translators",
  "home-robots": "Home robots",
  "ai-pcs": "AI PCs",
  other: "Other",
};
/** Learning Hub resource kinds and their URL segments (/learn/<segment>/<slug>). */
export type LearnKind = "course" | "book" | "tutorial";
export const LEARN_PATH: Record<LearnKind, string> = {
  course: "/learn/courses",
  book: "/learn/books",
  tutorial: "/learn/tutorials",
};
export const learnPathOf = (kind: LearnKind, slug: string) => `${LEARN_PATH[kind]}/${slug}`;

export const LEVELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  all: "All levels",
};

/** Reading time from the Markdown length (about 220 words, ~1,300 characters, a minute), at least 1. */
export const readingMinutes = (chars: number) => Math.max(1, Math.round(chars / 1300));
