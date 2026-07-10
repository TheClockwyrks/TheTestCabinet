import { ParticleSimulator } from "../simulator";
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
export class ParticleCanvasPlayer {
    /** The underlying pure simulator, exposed for inspection (live count, clock). */
    simulator;
    ctx;
    fieldWidth;
    fieldHeight;
    pixelRadius;
    composite;
    clear;
    constructor(system, ctx, opts = {}) {
        this.simulator = new ParticleSimulator(system, { seed: opts.seed });
        this.ctx = ctx;
        this.fieldWidth = Math.max(system.field.width, 1);
        this.fieldHeight = Math.max(system.field.height, 1);
        const extent = Math.max(this.fieldWidth, this.fieldHeight);
        this.pixelRadius = opts.pixelRadius ?? extent * 0.02;
        this.composite = opts.composite ?? "lighter";
        this.clear = opts.clear ?? true;
        this.draw();
    }
    /** Advance the effect by `dtSeconds` and composite the new state. */
    update(dtSeconds) {
        this.simulator.step(dtSeconds * 1000);
        this.draw();
    }
    /** Restart the effect from the beginning (replay a one-shot) and re-composite. */
    reset() {
        this.simulator.reset();
        this.draw();
    }
    /** Clear the canvas. There is no GPU state to release; provided for API symmetry. */
    dispose() {
        const { width, height } = this.ctx.canvas;
        this.ctx.clearRect(0, 0, width, height);
    }
    draw() {
        const ctx = this.ctx;
        const { width: cw, height: ch } = ctx.canvas;
        if (this.clear)
            ctx.clearRect(0, 0, cw, ch);
        const sx = cw / this.fieldWidth;
        const sy = ch / this.fieldHeight;
        const rScale = (sx + sy) * 0.5;
        const prevComposite = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = this.composite;
        for (const p of this.simulator.capture()) {
            const r = Math.max(p.size * this.pixelRadius * rScale, 0.5);
            const px = p.position[0] * sx;
            const py = ch - p.position[1] * sy; // `y` up → canvas y down.
            const [cr, cg, cb] = to255(p.color);
            const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
            grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${p.opacity})`);
            grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = prevComposite;
    }
}
/** A linear `0..1` RGB triple as `0..255` integer channels. */
function to255(color) {
    return [
        Math.round(clamp01(color[0]) * 255),
        Math.round(clamp01(color[1]) * 255),
        Math.round(clamp01(color[2]) * 255),
    ];
}
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
//# sourceMappingURL=ParticleCanvasPlayer.js.map