import type { PlotOptions } from "@observablehq/plot";

// The palette shared by every chart. These mirror the `--tcab-*` custom
// properties (styles/tokens.css) so charts read as part of the same world as
// the rest of the UI. We resolve the live custom-property values at render time
// when the document is available, falling back to the static hexes during
// SSR/prerender.
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
// getComputedStyle).
export function readChartPalette(): ChartPalette {
  return {
    text: cssVar("--tcab-text", FALLBACK.text),
    muted: cssVar("--tcab-muted", FALLBACK.muted),
    border: cssVar("--tcab-border", FALLBACK.border),
    surface: cssVar("--tcab-surface", FALLBACK.surface),
    accent: cssVar("--tcab-accent", FALLBACK.accent),
    accent2: cssVar("--tcab-accent-2", FALLBACK.accent2),
  };
}

// Base Plot options applied to every chart: transparent background (a backdrop
// shows through), themed text/grid, and a monospace font matching the UI.
// Helpers spread this first, then layer their own marks and scales.
export function basePlotOptions(palette: ChartPalette): PlotOptions {
  return {
    style: {
      background: "transparent",
      color: palette.text,
      fontFamily: "var(--tcab-font)",
      fontSize: "12px",
    },
    grid: true,
    marginLeft: 56,
    marginBottom: 40,
  };
}
