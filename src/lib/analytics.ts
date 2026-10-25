import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";

export const GA_MEASUREMENT_ID = "G-5W7XSC7VJN";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Google tag bootstrap, rendered once in the document <head> (see src/routes/__root.tsx).
// `send_page_view: false` stops gtag from sending its own automatic page_view, because
// page views are sent manually below so client-side route changes are counted without duplicates.
export const GA_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
export const GA_INLINE_SCRIPT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });`;

function sendPageView() {
  window.gtag?.("event", "page_view", {
    page_title: document.title,
    page_location: window.location.href,
    page_path: window.location.pathname + window.location.search,
  });
}

/** Sends one GA4 page_view for the first load and one for every later client-side navigation. */
export function usePageViewTracking() {
  const router = useRouter();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const track = () => {
      const path = window.location.pathname + window.location.search; // ignore #hash jumps
      if (path === lastPath.current) return; // de-duplicate
      lastPath.current = path;
      // Let the router commit the new <title> before reading document.title.
      window.setTimeout(sendPageView, 0);
    };
    track(); // initial page load
    return router.subscribe("onResolved", track);
  }, [router]);
}
