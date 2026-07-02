import { describe, expect, it } from "vitest";
import type { VoxelsFile } from "./contract";
import { buildPartMesh, hexToRgb } from "./mesh";

const file = (voxels: VoxelsFile["voxels"]): VoxelsFile => ({
  dims: { width: 4, height: 4, depth: 4 },
  voxels,
});

describe("buildPartMesh", () => {
  it("emits all six faces of an isolated voxel", () => {
    const mesh = buildPartMesh(file([{ x: 1, y: 1, z: 1, color: "#ff8000" }]));
    // 6 faces × 4 verts = 24 vertices (72 position floats), 6 × 2 tris = 36 indices.
    expect(mesh.positions.length).toBe(24 * 3);
    expect(mesh.indices.length).toBe(36);
    // Each vertex carries the voxel's color (Float32, so compare approximately).
    const [r, g, b] = hexToRgb("#ff8000");
    expect(mesh.colors[0]).toBeCloseTo(r, 5);
    expect(mesh.colors[1]).toBeCloseTo(g, 5);
    expect(mesh.colors[2]).toBeCloseTo(b, 5);
  });

  it("culls the shared interior face between two adjacent voxels", () => {
    const mesh = buildPartMesh(
      file([
        { x: 1, y: 1, z: 1, color: "#ffffff" },
        { x: 2, y: 1, z: 1, color: "#ffffff" },
      ]),
    );
    // Two touching voxels expose 5 faces each (the shared pair is culled): 10 faces.
    expect(mesh.indices.length).toBe(10 * 6);
    expect(mesh.positions.length).toBe(10 * 4 * 3);
  });

  it("produces an empty mesh for an empty part", () => {
    const mesh = buildPartMesh(file([]));
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });
});
