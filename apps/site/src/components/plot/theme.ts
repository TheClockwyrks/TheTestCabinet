import type { PlotOptions } from "@observablehq/plot";

// The neon palette shared by every chart. These mirror the `--ttc-*` theme
// custom properties (styles/theme.scss) and the backdrop palette so charts read
// as part of the same synthwave world. We resolve the live custom-property
// values at render time when the document is available, falling back to the
// static hexes during SSR/prerender.
const FALLBACK = {
  text: "#fdf3ff",
  muted: "#b69ad0",
  border: "#6a3aa0",
  surface: "#120a1c",
  accent: "#ff9d2f",
  accent2: "#ff5e3a",
} as const;

export interface ChartPalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  accent2: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

// Reads the live theme palette for charts. Must run on the client (touches
// getComputedStyle), mirroring backdrop/palette.ts.
export function readChartPalette(): ChartPalette {
  return {
    text: cssVar("--ttc-text", FALLBACK.text),
    muted: cssVar("--ttc-muted", FALLBACK.muted),
    border: cssVar("--ttc-border", FALLBACK.border),
    surface: cssVar("--ttc-surface", FALLBACK.surface),
    accent: cssVar("--ttc-accent", FALLBACK.accent),
    accent2: cssVar("--ttc-accent-2", FALLBACK.accent2),
  };
}

// Base Plot options applied to every chart: transparent background (the neon
// backdrop shows through), themed text/grid, and a monospace font matching the
// site. Helpers spread this first, then layer their own marks and scales.
export function basePlotOptions(palette: ChartPalette): PlotOptions {
  return {
    style: {
      background: "transparent",
      color: palette.text,
      fontFamily: "var(--ttc-font)",
      fontSize: "12px",
    },
    grid: true,
    marginLeft: 56,
    marginBottom: 40,
  };
}
