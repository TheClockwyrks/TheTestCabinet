// Volute — the two build-time facilities this project reaches for.
//
// `tsconfig.json` sets `"types": []`, so no ambient package types are pulled in
// automatically. Rather than take a dependency on `vite/client` (which brings in
// declarations for a dozen features this build does not use), the one Vite
// facility the sources touch is declared here: `import.meta.glob`, which is how
// every produced asset URL is resolved through the bundler and so comes out
// page-relative under any base path.

interface ImportMeta {
  /** Vite's eager, typed import glob. */
  glob<T>(
    pattern: string,
    options: {
      eager: true;
      query?: string;
      import?: string;
    },
  ): Record<string, T>;
}
