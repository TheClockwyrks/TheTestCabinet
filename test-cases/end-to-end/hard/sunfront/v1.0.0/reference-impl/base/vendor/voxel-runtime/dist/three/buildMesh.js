import * as THREE from "three";
/**
 * Wrap one part's {@link PartMesh} — the geometry the Rust meshing binaries already
 * extracted and emitted as a per-part binary glTF (`.glb`) — into a single {@link THREE.BufferGeometry}
 * with per-vertex colors (one geometry / one draw call). Use a material with
 * `vertexColors: true`.
 *
 * The runtime **does not mesh anything**: whichever binary produced the part (cube,
 * marching cubes, surface nets, or dual contouring) already ran the surface
 * extraction once, upstream, and every one yields the same `PartMesh` shape — so
 * this single load path serves them all, and this and the glTF exporter render the
 * exact same geometry.
 *
 * Each array is copied into the `Float32Array`/`Uint32Array` a
 * {@link THREE.BufferAttribute} requires, so a `.glb` decoded to typed arrays and an
 * in-memory `number[]` mesh are both accepted.
 */
export function buildPartGeometry(mesh) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(mesh.colors), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}
//# sourceMappingURL=buildMesh.js.map