import { describe, expect, it } from "vitest";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { CAMERA_FOV, cameraPosition, framing, type Vec3 } from "./voxelScene";

// Build a PartMesh whose only meaningful field for framing is `positions`: the
// eight corners of an axis-aligned box spanning [min, max] on each axis.
function boxMesh(min: Vec3, max: Vec3): PartMesh {
  const positions: number[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) positions.push(x, y, z);
  return { positions } as unknown as PartMesh;
}

// Re-project the framed box's silhouette independently of framing()'s internal
// solver: place the camera where framing() says, look at the origin, and return
// the largest |NDC| any corner reaches. `1` means a corner sits exactly on the
// frame edge; `> 1` means the model is clipped out of frame.
function maxNdc(mesh: PartMesh, center: Vec3, distance: number): number {
  const cam = cameraPosition(distance);
  const sub = (a: Vec3, b: Vec3): Vec3 => [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const z = norm(cam);
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  const tan = Math.tan((CAMERA_FOV * Math.PI) / 180 / 2);
  const p = mesh.positions;
  let max = 0;
  for (let i = 0; i + 2 < p.length; i += 3) {
    // Corner in world space, recentered to the origin exactly as the viewer's
    // centering pivot does before the camera looks at it.
    const world: Vec3 = [
      p[i]! - center[0],
      p[i + 1]! - center[1],
      p[i + 2]! - center[2],
    ];
    const rel = sub(world, cam);
    const depth = -dot(rel, z);
    const ndcX = Math.abs(dot(rel, x)) / (depth * tan);
    const ndcY = Math.abs(dot(rel, y)) / (depth * tan);
    max = Math.max(max, ndcX, ndcY);
  }
  return max;
}

// The offscreen render/encode path needs a real WebGL context, so it's exercised
// in the browser; here we lock down the camera framing — how tightly the model
// fills the frame and, crucially, that it never spills past the edge.
describe("framing", () => {
  const shapes: Record<string, PartMesh> = {
    cube: boxMesh([-10, -10, -10], [10, 10, 10]),
    tall: boxMesh([-3, -20, -3], [3, 20, 3]),
    wide: boxMesh([-24, -4, -6], [24, 4, 6]),
    flat: boxMesh([-15, -1, -15], [15, 1, 15]),
    offset: boxMesh([40, 40, 40], [60, 55, 70]),
  };

  it("centers on the model's bounding box", () => {
    const { center } = framing(shapes.offset!);
    expect(center).toEqual([50, 47.5, 55]);
  });

  for (const [name, mesh] of Object.entries(shapes)) {
    it(`fills the frame without clipping (${name})`, () => {
      const { center, distance } = framing(mesh);
      const fill = maxNdc(mesh, center, distance);
      // Fits within the frame with a small margin (never clipped)…
      expect(fill).toBeLessThan(1);
      // …and fills most of it — the whole point of the fix, regardless of whether
      // the model is cubic, tall, wide, or flat.
      expect(fill).toBeGreaterThan(0.78);
      expect(fill).toBeCloseTo(0.82, 1);
    });
  }

  it("frames tighter than the old bounding-size heuristic", () => {
    // The previous `size * 2.2` heuristic left the model at ~half the frame; the
    // fit pulls the camera meaningfully closer.
    const { distance } = framing(shapes.cube!);
    expect(distance).toBeLessThan(20 * 2.2);
  });

  it("falls back to a neutral frame when there is no geometry", () => {
    const { center, distance, far } = framing({
      positions: [],
    } as unknown as PartMesh);
    expect(center).toEqual([0, 0, 0]);
    expect(distance).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(distance);
  });
});
