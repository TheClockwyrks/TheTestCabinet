import { useMemo } from "react";
import { type Color } from "three";

interface BandedSunProps {
  top: Color;
  bottom: Color;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Vertical gradient with the signature retro twist: horizontal gaps carved into
// the lower half that widen toward the bottom, so the sun reads as banded.
const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uBottom;

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
    gl_FragColor = vec4(col, 1.0);
  }
`;

// The classic banded synthwave sun, mounted only when the user enables it. Sits
// in the distance behind the terrain valley; intentionally not fogged so it
// stays the vivid focal point.
export function BandedSun({ top, bottom }: BandedSunProps) {
  const uniforms = useMemo(
    () => ({ uTop: { value: top.clone() }, uBottom: { value: bottom.clone() } }),
    [top, bottom],
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
