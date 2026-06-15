import { Color } from "three";

// The synthwave scene's colors are derived from the site theme's `--ttc-*`
// custom properties (declared in `styles/theme.scss`), keeping the theme the
// single source of color truth. Only the solid hex tokens are read here;
// `--ttc-grid`/`--ttc-scanline` are rgba and stay in the CSS layers.
export interface ScenePalette {
  // Neon grid lines closest to the camera.
  gridNear: Color;
  // Grid lines fading toward the horizon.
  gridFar: Color;
  // Wireframe terrain ridges.
  terrain: Color;
  // Sun gradient, top to bottom.
  sunTop: Color;
  sunBottom: Color;
  // Distance fog, matched to the page background so terrain dissolves into it.
  fog: Color;
}

function cssColor(name: string, fallback: string): Color {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  // `new Color` throws on an unrecognized string; fall back defensively so a
  // theme change can never break the backdrop.
  try {
    return new Color(raw || fallback);
  } catch {
    return new Color(fallback);
  }
}

// Reads the live theme palette. Call once on the client (after mount) — it
// touches `getComputedStyle`, so it must not run during prerender.
export function readScenePalette(): ScenePalette {
  return {
    gridNear: cssColor("--ttc-accent", "#ff9d2f"),
    gridFar: cssColor("--ttc-accent-2", "#ff5e3a"),
    terrain: cssColor("--ttc-border", "#6a3aa0"),
    sunTop: cssColor("--ttc-accent", "#ff9d2f"),
    sunBottom: cssColor("--ttc-accent-2", "#ff5e3a"),
    fog: cssColor("--ttc-bg-2", "#0a0414"),
  };
}
