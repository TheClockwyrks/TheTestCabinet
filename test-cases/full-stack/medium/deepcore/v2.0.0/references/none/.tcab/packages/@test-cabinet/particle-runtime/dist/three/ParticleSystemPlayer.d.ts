import * as THREE from "three";
import type { ParticleSystem } from "../contract";
import { ParticleSimulator } from "../simulator";
/** Options for {@link ParticleSystemPlayer}. */
export interface ParticleSystemPlayerOptions {
    /** Base seed for reproducible playback; omit for a fresh, varying play. */
    seed?: number;
    /**
     * The pixel size a unit-size (`size = 1`) particle billboards to at one world unit of
     * depth, before perspective attenuation. Scale it to your scene's units. Defaults to
     * a size derived from the field extent so a fresh system reads reasonably.
     */
    pixelScale?: number;
    /**
     * Initial GPU buffer capacity (particles). The buffers grow automatically when the
     * live count exceeds it; sizing it near the effect's peak avoids reallocation.
     */
    capacity?: number;
    /**
     * Blending mode. Defaults to {@link THREE.AdditiveBlending}, which reads right for
     * fire/energy VFX; pass {@link THREE.NormalBlending} for smoke/debris.
     */
    blending?: THREE.Blending;
}
/**
 * A live three.js particle effect: a {@link THREE.Points} cloud of soft round
 * billboards driven by a {@link ParticleSimulator}. The particle analogue of
 * `@test-cabinet/voxel-runtime`'s `VoxelRig` — but where a rig is *posed* from decoded
 * geometry, a system is *simulated* from its definition, so {@link update} steps the
 * simulation forward rather than sampling a clip.
 *
 * Add {@link ParticleSystemPlayer.points} to your scene. Each {@link update} steps the
 * simulator and rewrites the point cloud's per-particle position, color, size, and
 * opacity attributes from the freshly simulated state. The system's `loop` flag is
 * honoured by the simulator; call {@link reset} to replay a one-shot from the start.
 */
export declare class ParticleSystemPlayer {
    /** The scene node to add to your three.js scene. */
    readonly points: THREE.Points;
    /** The underlying pure simulator, exposed for inspection (live count, clock). */
    readonly simulator: ParticleSimulator;
    private geometry;
    private readonly material;
    private capacity;
    constructor(system: ParticleSystem, opts?: ParticleSystemPlayerOptions);
    /** Advance the effect by `dtSeconds` and rewrite the GPU buffers from the new state. */
    update(dtSeconds: number): void;
    /** Restart the effect from the beginning (replay a one-shot) and re-sync. */
    reset(): void;
    /** Release GPU geometry and the material, and detach the point cloud. */
    dispose(): void;
    private allocate;
    /** Rewrite the point-cloud attributes from the simulator's captured particles. */
    private sync;
}
//# sourceMappingURL=ParticleSystemPlayer.d.ts.map