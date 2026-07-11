// Meltdown — color helpers. The heat ramp (cold blue -> warm amber -> hot
// orange -> white-hot) is the visual language of the whole game (specs/heat.md).

import { C } from "./constants";

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: RGB, b: RGB, t: number): string {
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bl = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r}, ${g}, ${bl})`;
}

const RAMP: Array<{ h: number; rgb: RGB }> = [
  { h: 0, rgb: hexToRgb(C.cold) },
  { h: 50, rgb: hexToRgb(C.warm) },
  { h: 80, rgb: hexToRgb(C.hot) },
  { h: 100, rgb: hexToRgb(C.white) },
];

// Colour for a given heat 0..100 along the ramp.
export function heatColor(h: number): string {
  const clamped = Math.max(0, Math.min(100, h));
  for (let i = 1; i < RAMP.length; i++) {
    if (clamped <= RAMP[i].h) {
      const lo = RAMP[i - 1];
      const hi = RAMP[i];
      const t = (clamped - lo.h) / (hi.h - lo.h);
      return mix(lo.rgb, hi.rgb, t);
    }
  }
  return C.white;
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
