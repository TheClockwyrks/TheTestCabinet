import type { ParticleSystem } from "../contract";
import { ParticleSimulator } from "../simulator";
/** Options for {@link ParticleCanvasPlayer}. */
export interface ParticleCanvasPlayerOptions {
    /** Base seed for reproducible playback; omit for a fresh, varying play. */
    seed?: number;
    /**
     * The canvas-pixel radius a unit-size (`size = 1`) particle draws at, before the
     * field→canvas fit is applied. Defaults to a fraction of the field extent.
     */
    pixelRadius?: number;
    /**
     * Composite mode. Defaults to `"lighter"` (additive), which reads right for
     * fire/energy VFX; pass `"source-over"` for smoke/debris.
     */
    composite?: GlobalCompositeOperation;
    /**
     * Whether {@link ParticleCanvasPlayer.update} clears the canvas before compositing.
     * Defaults to `true`; set `false` to composite onto an existing scene the caller
     * clears itself.
     */
    clear?: boolean;
}
/**
 * A live 2D-canvas particle effect: the {@link ParticleCanvasPlayer} composites a
 * {@link ParticleSimulator}'s particles as soft radial-gradient discs into a
 * `CanvasRenderingContext2D`. The canvas analogue of the `three` binding's
 * {@link import("../three").ParticleSystemPlayer} — same simulated state, a 2D raster
 * path instead of billboards.
 *
 * The field's `[width, height]` is fit to the canvas (with `y` up → down flipped), so a
 * `particle-2d` system composites in place. A 3D system's `z` is simply dropped.
 */
export declare class ParticleCanvasPlayer {
    /** The underlying pure simulator, exposed for inspection (live count, clock). */
    readonly simulator: ParticleSimulator;
    private readonly ctx;
    private readonly fieldWidth;
    private readonly fieldHeight;
    private readonly pixelRadius;
    private readonly composite;
    private readonly clear;
    constructor(system: ParticleSystem, ctx: CanvasRenderingContext2D, opts?: ParticleCanvasPlayerOptions);
    /** Advance the effect by `dtSeconds` and composite the new state. */
    update(dtSeconds: number): void;
    /** Restart the effect from the beginning (replay a one-shot) and re-composite. */
    reset(): void;
    /** Clear the canvas. There is no GPU state to release; provided for API symmetry. */
    dispose(): void;
    private draw;
}
//# sourceMappingURL=ParticleCanvasPlayer.d.ts.map