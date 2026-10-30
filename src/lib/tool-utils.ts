// Small display helpers with no data imports, so browser code can use them without bundling tools.json.

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
export const logoOf = (url: string, size = 64) => {
  const d = domainOf(url);
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=${size}` : "";
};
export const shortName = (c: string) => c.replace(/^AI /, "").replace(/ Tools$/, "");
