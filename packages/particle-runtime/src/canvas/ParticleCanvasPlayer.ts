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
export class ParticleCanvasPlayer {
  /** The underlying pure simulator, exposed for inspection (live count, clock). */
  readonly simulator: ParticleSimulator;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly fieldWidth: number;
  private readonly fieldHeight: number;
  private readonly pixelRadius: number;
  private readonly composite: GlobalCompositeOperation;
  private readonly clear: boolean;

  constructor(
    system: ParticleSystem,
    ctx: CanvasRenderingContext2D,
    opts: ParticleCanvasPlayerOptions = {},
  ) {
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
  update(dtSeconds: number): void {
    this.simulator.step(dtSeconds * 1000);
    this.draw();
  }

  /** Restart the effect from the beginning (replay a one-shot) and re-composite. */
  reset(): void {
    this.simulator.reset();
    this.draw();
  }

  /** Clear the canvas. There is no GPU state to release; provided for API symmetry. */
  dispose(): void {
    const { width, height } = this.ctx.canvas;
    this.ctx.clearRect(0, 0, width, height);
  }

  private draw(): void {
    const ctx = this.ctx;
    const { width: cw, height: ch } = ctx.canvas;
    if (this.clear) ctx.clearRect(0, 0, cw, ch);

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
function to255(color: readonly [number, number, number]): [number, number, number] {
  return [
    Math.round(clamp01(color[0]) * 255),
    Math.round(clamp01(color[1]) * 255),
    Math.round(clamp01(color[2]) * 255),
  ];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
