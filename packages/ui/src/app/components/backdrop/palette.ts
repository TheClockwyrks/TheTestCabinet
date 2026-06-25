import { Color } from "three";

// The synthwave scene's colors are derived from the site theme's `--ttc-*`
// custom properties (declared in `styles/theme.scss`), keeping the theme the
// single source of color truth. The solid hex tokens are read as colors;
// `--ttc-grid` is rgba and stays in the CSS layers, while `--ttc-scanline`'s
// alpha is read here to drive the CRT lines now baked into the sun shader.
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
  // Strength of the CRT scanlines drawn over the sun (0–1), from the alpha of
  // the `--ttc-scanline` token. The scanlines live in the sun shader so they
  // never touch the grid or terrain.
  scanlineAlpha: number;
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

// Reads the alpha component of an `rgb()/rgba()` custom property (the only
// channel the sun's scanlines need). `getComputedStyle` resolves the token to a
// concrete `rgba(r, g, b, a)` string; a missing alpha means fully opaque.
function cssAlpha(name: string, fallback: number): number {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const inner = raw.match(/rgba?\(([^)]+)\)/i)?.[1];
  if (!inner) {
    return fallback;
  }
  const parts = inner.split(",").map((part) => Number.parseFloat(part));
  const alpha = parts.length >= 4 ? parts[3] : 1;
  return alpha !== undefined && Number.isFinite(alpha) ? alpha : fallback;
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
    scanlineAlpha: cssAlpha("--ttc-scanline", 0.4),
  };
}
