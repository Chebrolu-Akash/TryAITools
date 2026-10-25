export const SITE_NAME = "TryAITools";
export const SITE_URL = "https://tryaitools.io";
export const SITE_TAGLINE = "Discover the best AI tools for every task";
export const SITE_DESCRIPTION =
  "Browse over 2,000 hand-picked AI tools for writing, images, video, audio, coding, marketing and more — organized into clear categories.";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;
// Set this to a monitored address to show a contact line on the legal pages.
export const CONTACT_EMAIL = "";
export const LEGAL_UPDATED = "October 25, 2026";

export const absoluteUrl = (path = "/") => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
