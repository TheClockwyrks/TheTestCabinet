import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGlb } from "./glb";

/** Read a fixture `.glb` as a tightly-sized `ArrayBuffer` (not a pooled Buffer view). */
function readGlb(name: string): ArrayBuffer {
  const buf = readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("parseGlb", () => {
  // `hull.glb` is a real per-part glb the `mc-anim` binary emitted for a single
  // `add-box` (cx 12 cy 6 cz 12, 12×8×12, color #808080) — 110 vertices, 648 indices.
  it("decodes a real per-part glb into a PartMesh with the expected arrays", () => {
    const mesh = parseGlb(readGlb("hull.glb"));

    // 110 vertices → 330 floats per VEC3 attribute; 648 triangle indices.
    expect(mesh.positions.length).toBe(330);
    expect(mesh.normals.length).toBe(330);
    expect(mesh.colors.length).toBe(330);
    expect(mesh.indices.length).toBe(648);

    // The attributes decode as typed arrays (F32 VEC3 / U32 SCALAR).
    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.colors).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);

    // #808080 is linear ≈0.502 per channel; sample the first few color components.
    for (let i = 0; i < 6; i++) {
      expect(mesh.colors[i]).toBeCloseTo(0.502, 2);
    }

    // Every index addresses a real vertex (330/3 = 110 vertices).
    const vertexCount = mesh.positions.length / 3;
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(vertexCount);
    }
  });

  // An attach socket (a part with no geometry) is emitted as a valid glb with no
  // meshes; it must decode to a PartMesh whose four arrays are all empty.
  it("decodes an empty-part glb (no meshes) into empty arrays", () => {
    const mesh = parseGlb(readGlb("socket-empty.glb"));
    expect(mesh.positions.length).toBe(0);
    expect(mesh.normals.length).toBe(0);
    expect(mesh.colors.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it("rejects a buffer that is not a glb", () => {
    expect(() => parseGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer)).toThrow();
  });
});
