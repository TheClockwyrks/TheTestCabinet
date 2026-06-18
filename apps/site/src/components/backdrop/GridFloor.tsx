import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  type ShaderMaterial,
} from "three";

interface GridFloorProps {
  near: Color;
  far: Color;
}

// Vanishing-point grid: world XZ coordinates are folded into cells and the
// cell pattern is scrolled toward the camera each frame, fading out toward the
// horizon. `fwidth` keeps the lines a crisp ~1px regardless of distance.
const VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform float uCell;
  uniform float uSpeed;
  uniform float uFade;
  uniform vec3 uColorNear;
  uniform vec3 uColorFar;

  void main() {
    // Fold world XZ into grid cells. Subtracting time advances the pattern
    // toward +z, so the lines stream toward the viewer (the camera looks -Z).
    vec2 coord = vWorldPos.xz / uCell;
    coord.y -= uTime * uSpeed;
    vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float line = 1.0 - min(min(g.x, g.y), 1.0);

    // Distance into the scene grows as -z; fade lines out before the horizon.
    // (Anything behind the camera is already frustum-culled, so no near discard
    // is needed — and one here would clip the foreground off the bottom edge.)
    float dist = -vWorldPos.z;
    float fade = clamp(1.0 - dist / uFade, 0.0, 1.0);

    float alpha = line * fade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uColorFar, uColorNear, fade), alpha);
  }
`;

export function GridFloor({ near, far }: GridFloorProps) {
  const material = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCell: { value: 1.5 },
      uSpeed: { value: 0.45 },
      uFade: { value: 115 },
      uColorNear: { value: near.clone() },
      uColorFar: { value: far.clone() },
    }),
    [near, far],
  );

  // R3F copies the `uniforms` prop into the material's own uniforms object
  // rather than holding our reference, so the scroll must be driven through the
  // material's uniforms — mutating the memoized object above has no effect.
  useFrame((_, delta) => {
    const time = material.current?.uniforms.uTime;
    const speed = material.current?.uniforms.uSpeed;
    if (time && speed) {
      // The scroll pattern repeats every 1/uSpeed seconds (`fract` has period 1
      // in cell space), so wrap uTime to that period. Left unbounded it grows
      // for the whole session — and once large it loses float32 precision when
      // uploaded to the shader, making the scrolled (horizontal) lines step
      // unevenly and stutter on a long-lived tab.
      const period = 1 / speed.value;
      time.value = (time.value + delta) % period;
    }
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0}>
      <planeGeometry args={[420, 420]} />
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        side={DoubleSide}
      />
    </mesh>
  );
}
