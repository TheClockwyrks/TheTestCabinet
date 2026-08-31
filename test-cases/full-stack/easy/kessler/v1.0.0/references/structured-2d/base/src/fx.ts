// Kessler — the produced particle systems, played live (specs/assets.md).
//
// A destruction plays the burst at the target's arc center, a paddle,
// containment, or shield reflection plays the spark at the contact, and a
// ball or pod reaching the planet plays the burn-up at it. Each is the
// produced `system.json`, simulated by `@test-cabinet/particle-runtime`'s
// canvas binding — and THE PLAYER IS HANDED THE SAME CONTEXT THE FIELD IS
// DRAWN INTO: the one the engine's pipeline hands this draw component, in its
// place in the layer order, exactly as `specs/assets.md` asks. The player
// maps its system's field across the whole backing store, so each instance is
// drawn under a transform that folds that box down onto the footprint its
// event calls for; the maps compose so a particle lands exactly where the
// simulation put it. The seed option is left unset, so each play varies, and
// that variation is correct.
//
// The layer advances on the game's resolved-tick clock rather than the wall
// clock, so effects hold with the simulation under a stepped scenario and a
// replayed frame reproduces what a played one shows.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import { DrawComponent, type DrawApi } from "@test-cabinet/structured-2d";
import { kesslerAssets } from "./assets";
import { TICK_DT } from "./constants";
import { kesslerState } from "./state";
import type { ParticleSystemName } from "./sim";

/** The square of logical units each system's field is folded down onto. */
const FOOTPRINT: Record<ParticleSystemName, number> = {
  burst: 132,
  spark: 88,
  burnup: 124,
};

/** One live effect. The player is built lazily, on its first draw. */
interface Play {
  readonly system: ParticleSystemName;
  readonly x: number;
  readonly y: number;
  /** Seconds of game time the effect has run. */
  age: number;
  player: ParticleCanvasPlayer | null;
}

/**
 * The one render component the live effects composite through. The game mode
 * spawns its actor and hands `spawn` to the simulation as the tick hooks'
 * particle spawner.
 */
export class FxLayer extends DrawComponent {
  private plays: Play[] = [];
  /** The resolved-tick count the last draw ran at. */
  private drawnTicks = 0;

  /** Play `system` centered on the stage point `(x, y)`. */
  spawn(system: ParticleSystemName, x: number, y: number): void {
    if (kesslerAssets().systems[system] === undefined) return;
    this.plays.push({ system, x, y, age: 0, player: null });
    // A runaway scenario cannot pile up unbounded players.
    if (this.plays.length > 64) this.plays.shift();
  }

  /** Drop every live effect — a debug reset wants a bare field. */
  clear(): void {
    this.plays = [];
  }

  /** How many effects are live, for the diagnostics overlay. */
  get count(): number {
    return this.plays.length;
  }

  /**
   * Advance every effect by the game time the resolved ticks carried since
   * the last draw and composite it over the frame. Composited on EVERY
   * frame, a zero delta included: a frame that ran no tick still redraws the
   * whole field, and the effects must be laid back over it or a stepped
   * scenario's screenshot would lose them.
   */
  draw(api: DrawApi): void {
    const ctx = api.ctx;
    const canvas = ctx.canvas;
    if (!(canvas.width > 0) || !(canvas.height > 0)) return;
    const ticks = kesslerState(this.world).ticks;
    const dtSeconds = Math.max(0, ticks - this.drawnTicks) * TICK_DT;
    this.drawnTicks = ticks;
    const systems = kesslerAssets().systems;
    for (const play of this.plays) {
      const spec = systems[play.system];
      if (spec === undefined) continue;
      const box = FOOTPRINT[play.system];
      play.age += dtSeconds;
      ctx.save();
      ctx.translate(play.x - box / 2, play.y - box / 2);
      ctx.scale(box / canvas.width, box / canvas.height);
      if (play.player === null) {
        // Building the player composites its opening state at once, so it
        // has to happen under the transform that puts it in place.
        play.player = new ParticleCanvasPlayer(spec, ctx, {
          composite: "lighter",
          // The field is already drawn; the player composites onto it.
          clear: false,
        });
      } else {
        play.player.update(dtSeconds);
      }
      ctx.restore();
    }
    this.plays = this.plays.filter((play) => {
      const spec = systems[play.system];
      if (spec === undefined || play.player === null) return false;
      return (
        play.age * 1000 <= spec.durationMs ||
        play.player.simulator.liveCount > 0
      );
    });
  }
}
