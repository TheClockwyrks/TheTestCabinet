/**
 * `@clockwyrks/voxel-runtime` — framework-agnostic core.
 *
 * The pure posing/clip math and contract types, with no `three` dependency.
 * The optional three.js binding (mesh building + `VoxelRig`) is exported from
 * the `@clockwyrks/voxel-runtime/three` subpath instead.
 */
export * from "./contract";
export * from "./clips";
export * from "./hierarchy";
export { parseGlb, parseSkinnedGlb } from "./glb";
export { skinMesh, skinningMatrices } from "./skin";
export type { SkinnableMesh } from "./skin";
//# sourceMappingURL=index.d.ts.map