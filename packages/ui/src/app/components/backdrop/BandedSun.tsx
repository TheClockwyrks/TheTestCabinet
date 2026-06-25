import { useMemo } from "react";
import { type Color } from "three";

interface BandedSunProps {
  top: Color;
  bottom: Color;
  // CRT scanline strength (0–1); see `palette.scanlineAlpha`.
  scanlineAlpha: number;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Vertical gradient with the signature retro twist: horizontal gaps carved into
// the lower half that widen toward the bottom, so the sun reads as banded. CRT
// scanlines are baked in here (rather than as a full-screen overlay) so they
// fall only on the sun, leaving the grid and terrain clean.
const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uScanline;

  // Number of fine scanline cycles across the sun's height. Anchored to the
  // sun's UV rather than screen pixels so the count holds on any display.
  const float SCANLINE_COUNT = 60.0;

  void main() {
    float y = vUv.y; // 0 at bottom, 1 at top
    vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, y));

    float alpha = 1.0;
    if (y < 0.5) {
      float p = (0.5 - y) * 2.0;     // 0 at the middle, 1 at the bottom
      float stripe = fract(p * 7.0); // repeating horizontal bands
      float gap = clamp(p * 0.9, 0.0, 0.85); // gaps thicken downward
      alpha = step(gap, stripe);
    }
    if (alpha < 0.5) discard;

    // Fine CRT scanlines over the sun. Keyed to the sun's UV (not screen
    // pixels): a screen-pixel cadence collapses to a flat tint on HiDPI
    // displays, whereas a fixed UV count stays visible everywhere. Each cycle
    // darkens its top third, echoing the old overlay's 1-in-3 cadence.
    float scan = step(2.0 / 3.0, fract(vUv.y * SCANLINE_COUNT)) * uScanline;
    col *= 1.0 - scan;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// The classic banded synthwave sun, mounted only when the user enables it. Sits
// in the distance behind the terrain valley; intentionally not fogged so it
// stays the vivid focal point.
export function BandedSun({ top, bottom, scanlineAlpha }: BandedSunProps) {
  const uniforms = useMemo(
    () => ({
      uTop: { value: top.clone() },
      uBottom: { value: bottom.clone() },
      uScanline: { value: scanlineAlpha },
    }),
    [top, bottom, scanlineAlpha],
  );

  return (
    <mesh position={[0, 8, -112]}>
      <circleGeometry args={[15, 64]} />
      <shaderMaterial
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}
