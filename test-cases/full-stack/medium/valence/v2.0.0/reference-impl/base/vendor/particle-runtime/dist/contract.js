/**
 * The contract types the particle runtime operates on — the `system.json` shape the
 * `particle-2d` / `particle-3d` binaries emit.
 *
 * The run-record's generated `AssetKind` union and any generated `system.json` type
 * are produced from Rust via contract-codegen; at the time of writing that codegen has
 * not yet emitted a particle-system type, so the system shapes below are declared
 * locally, matching the documented `system.json` contract (see
 * `apps/docs/.../testing/asset-generation/particle-binaries.md`). The one shared enum
 * that already exists in the generated package — {@link InterpSpec}, the F-curve
 * interpolation — is re-exported from there so there is a single source of truth for
 * it, exactly as `@test-cabinet/voxel-runtime`'s contract re-exports the rig types.
 */
export {};
//# sourceMappingURL=contract.js.map