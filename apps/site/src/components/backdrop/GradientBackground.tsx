import { useMemo } from "react";
import { type Color } from "three";

interface GradientBackgroundProps {
  top: Color;
  mid: Color;
  bottom: Color;
}

// Emit clip-space coordinates directly so the quad ignores the camera and
// always fills the viewport; z = 1 parks it on the far plane. A `PlaneGeometry`
// spans [-1, 1] in x/y, which is exactly NDC.
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// Vertical three-stop gradient. `vUv.y` is 0 at the bottom edge and 1 at the
// top; the page gradient places its mid stop 55% down from the top, i.e. 0.45
// up from the bottom.
const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;

  void main() {
    vec3 col = vUv.y > 0.45
      ? mix(uMid, uTop, (vUv.y - 0.45) / 0.55)
      : mix(uBottom, uMid, vUv.y / 0.45);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Opaque screen-space backdrop drawn behind the scene. The WebGL canvas is now
// opaque (so a software page compositor only has to blit it, not alpha-blend a
// full-viewport translucent layer every frame), which means the scene has to
// paint the sunset gradient the page used to show through. Rendered first
// (`renderOrder={-1}`, depth test/write off) so every other object lands on top.
export function GradientBackground({ top, mid, bottom }: GradientBackgroundProps) {
  const uniforms = useMemo(
    () => ({
      uTop: { value: top.clone() },
      uMid: { value: mid.clone() },
      uBottom: { value: bottom.clone() },
    }),
    [top, mid, bottom],
  );

  return (
    // The shader pins the quad to the viewport regardless of camera, so its
    // origin-centered bounds would be wrongly culled — opt out.
    <mesh renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
