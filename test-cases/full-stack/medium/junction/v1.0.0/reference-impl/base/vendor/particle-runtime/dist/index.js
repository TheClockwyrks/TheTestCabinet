/**
 * `@test-cabinet/particle-runtime` — framework-agnostic core.
 *
 * Turns a particle run's `system.json` into a **playable effect** by **simulating it
 * live** — stepping the emitters and forces and evaluating the per-particle curves each
 * frame — the particle analogue of `@test-cabinet/voxel-runtime`, where a rig is
 * *posed* but a system is *simulated*.
 *
 * This entry point is pure: the contract types, the curve/gradient sampling, the
 * deterministic PRNG, and the {@link ParticleSimulator}, with no rendering dependency.
 * The optional bindings live at the subpaths:
 * - `@test-cabinet/particle-runtime/three` — a three.js billboard point cloud.
 * - `@test-cabinet/particle-runtime/canvas` — a 2D-canvas compositor.
 */
export * from "./contract";
export { easeFraction, sampleCurve, sampleGradient, hexToLinear, sizeAt, opacityAt, colorAt, } from "./curves";
export { Rng } from "./rng";
export { ParticleSimulator } from "./simulator";
//# sourceMappingURL=index.js.map