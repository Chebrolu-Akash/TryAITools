import "@testing-library/jest-dom/vitest";

// Files marked `// @vitest-environment node` have no `window`; only stub the browser when there is one.
const hasWindow = typeof window !== "undefined";

if (hasWindow)
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => {},
  });

if (hasWindow)
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
