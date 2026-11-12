import {
  Briefcase,
  Code2,
  FileText,
  GraduationCap,
  Image,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  Mic,
  Palette,
  PenLine,
  Search,
  Share2,
  ShoppingCart,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

// One icon per category, keyed by its slug (names and database values are unchanged). A category added later without an
// entry here gets the neutral grid icon.
const ICONS: Record<string, LucideIcon> = {
  "ai-writing-tools": PenLine,
  "ai-image-tools": Image,
  "ai-video-tools": Video,
  "ai-audio-voice-tools": Mic,
  "ai-chatbots-assistants": MessageSquare,
  "ai-marketing-tools": Megaphone,
  "ai-seo-tools": Search,
  "ai-coding-developer-tools": Code2,
  "ai-design-ui-ux-tools": Palette,
  "ai-social-media-tools": Share2,
  "ai-business-tools": Briefcase,
  "ai-office-tools": FileText,
  "ai-resume-hr-tools": Users,
  "ai-education-learning-tools": GraduationCap,
  "ai-e-commerce-tools": ShoppingCart,
};

export const categoryIconFor = (slug: string): LucideIcon => ICONS[slug] ?? LayoutGrid;

/** Decorative: the category name next to it is the accessible label. */
export function CategoryIcon({
  slug,
  className = "h-4 w-4",
}: {
  slug: string;
  className?: string;
}) {
  const Icon = categoryIconFor(slug);
  return <Icon aria-hidden focusable="false" strokeWidth={2} className={`shrink-0 ${className}`} />;
}
