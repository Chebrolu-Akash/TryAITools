export const SITE_NAME = "TryAITools";
export const SITE_URL = "https://tryaitools.io";
export const SITE_TAGLINE = "Discover the best AI tools for every task";
export const SITE_DESCRIPTION =
  "Browse AI tools for writing, images, video, audio, coding, marketing and more — organized into clear categories, with reviewed picks and AI news.";
/** A count that never overstates: 1,870 -> "1,800+", 95 -> "95". */
export const countLabel = (n: number) =>
  n >= 200 ? `${(Math.floor(n / 100) * 100).toLocaleString("en-US")}+` : String(n);
/** Appends the site name only while the whole title stays within ~60 characters (what Google shows in results). */
export const titleWithSite = (t: string) =>
  t.length + SITE_NAME.length + 3 <= 60 ? `${t} | ${SITE_NAME}` : t;
export const OG_IMAGE = `${SITE_URL}/og-image.png`;
// Set this to a monitored address to show a contact line on the legal pages.
export const CONTACT_EMAIL = "";
export const LEGAL_UPDATED = "October 25, 2026";

export const absoluteUrl = (path = "/") => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
