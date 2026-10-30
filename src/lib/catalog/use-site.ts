import { useMatch } from "@tanstack/react-router";

export type SiteSummary = { toolCount: number; categories: { name: string; slug: string }[] };
const EMPTY: SiteSummary = { toolCount: 0, categories: [] };

/** Tool count and category links loaded once by the root route (see src/routes/__root.tsx). */
export function useSiteSummary(): SiteSummary {
  const match = useMatch({ from: "__root__", shouldThrow: false });
  return (match?.loaderData as SiteSummary | undefined) ?? EMPTY;
}
