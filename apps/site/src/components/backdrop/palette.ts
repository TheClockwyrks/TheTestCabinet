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
  // Vertical background gradient (screen top → middle → bottom), mirroring the
  // CSS `.backdrop` gradient. With the WebGL canvas now opaque (see
  // `SynthwaveScene`) the scene paints this itself instead of letting the page
  // gradient show through a translucent canvas.
  bgTop: Color;
  bgMid: Color;
  bgBottom: Color;
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
    // Stops mirror the `.backdrop` gradient in `Backdrop.module.scss`: `--ttc-bg`
    // at the top, `--ttc-bg-2` at the 55% mid stop, and a slightly warmer void
    // at the bottom (a literal there, with no matching token to read).
    bgTop: cssColor("--ttc-bg", "#050108"),
    bgMid: cssColor("--ttc-bg-2", "#0a0414"),
    bgBottom: new Color("#14061f"),
  };
}
