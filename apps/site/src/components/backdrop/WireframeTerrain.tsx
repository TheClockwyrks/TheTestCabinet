import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Color, type Mesh, PlaneGeometry } from "three";

interface WireframeTerrainProps {
  color: Color;
}

const WIDTH = 320;
const DEPTH = 110;
const SEG_X = 96;
const SEG_Y = 40;
// Half-width of the central valley kept low so the sun and horizon stay clear.
const VALLEY_HALF = 22;
const AMPLITUDE = 22;

// Deterministic ridged height so the range looks identical on every load (no
// RNG) — layered sines standing in for value noise.
function ridge(x: number, y: number): number {
  return (
    Math.sin(x * 0.15) * 0.5 +
    Math.sin(x * 0.37 + 1.3) * 0.3 +
    Math.sin(x * 0.21 + y * 0.26) * 0.45 +
    Math.sin(y * 0.31 + 2.1) * 0.2
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

// A displaced wireframe plane standing in the distance: mountain ridges flank a
// central valley (so the optional sun reads cleanly) and grow taller toward the
// back, where scene fog dissolves them into the page background.
export function WireframeTerrain({ color }: WireframeTerrainProps) {
  const mesh = useRef<Mesh>(null);

  const geometry = useMemo(() => {
    const geom = new PlaneGeometry(WIDTH, DEPTH, SEG_X, SEG_Y);
    const pos = geom.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i); // local depth; back of the range is +y
      // Flatten the center into a valley, full height out at the flanks.
      const flank = smoothstep(VALLEY_HALF, WIDTH / 2, Math.abs(x));
      // Taller toward the back of the range.
      const depth = smoothstep(-DEPTH / 2, DEPTH / 2, y);
      const h = Math.max(0, ridge(x, y)) * flank * (0.45 + 0.55 * depth);
      // Local +Z becomes world up after the mesh's -90° X rotation.
      pos.setZ(i, h * AMPLITUDE);
    }
    geom.computeVertexNormals();
    return geom;
  }, []);

  useFrame(({ clock }) => {
    if (mesh.current) {
      // Gentle parallax sway so the distant range feels alive without drifting
      // far enough to expose the plane edges.
      mesh.current.position.x = Math.sin(clock.elapsedTime * 0.05) * 2.5;
    }
  });

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      rotation-x={-Math.PI / 2}
      position-z={-72}
    >
      <meshBasicMaterial
        color={color}
        wireframe
        transparent
        opacity={0.55}
      />
    </mesh>
  );
}
