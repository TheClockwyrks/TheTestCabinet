import { describe, expect, it } from "vitest";
import type { PartMesh } from "../contract";
import { buildPartGeometry } from "./buildMesh";

// One triangle's worth of a `mesh.json`, as plain `number[]` arrays (the shape a
// decoded `mesh.json` has).
const tri: PartMesh = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  colors: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  indices: [0, 1, 2],
};

describe("buildPartGeometry", () => {
  it("wraps a PartMesh's arrays into typed BufferAttributes without re-meshing", () => {
    const geo = buildPartGeometry(tri);
    const position = geo.getAttribute("position");
    expect(position.count).toBe(3);
    expect(position.array).toBeInstanceOf(Float32Array);
    expect(geo.getAttribute("color").count).toBe(3);
    expect(geo.getIndex()?.count).toBe(3);
    expect(geo.getIndex()?.array).toBeInstanceOf(Uint32Array);
    // The geometry is uploaded as-is: positions match the source, in order.
    expect(Array.from(position.array)).toEqual(tri.positions);
    geo.dispose();
  });

  it("accepts a mesh already backed by typed arrays", () => {
    const geo = buildPartGeometry({
      positions: new Float32Array(tri.positions as number[]),
      normals: new Float32Array(tri.normals as number[]),
      colors: new Float32Array(tri.colors as number[]),
      indices: new Uint32Array(tri.indices as number[]),
    });
    expect(geo.getAttribute("position").count).toBe(3);
    geo.dispose();
  });
});
