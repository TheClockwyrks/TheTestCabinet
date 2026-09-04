// Kessler — the produced particle systems, played live (specs/assets.md).
//
// A destruction plays the burst at the target's arc center, a paddle,
// containment, or shield reflection plays the spark at the contact, and a
// ball or pod reaching the planet plays the burn-up at it. Each is the
// produced `system.json`, simulated by `@test-cabinet/particle-runtime`'s
// canvas binding — and THE PLAYER IS HANDED THE SAME CONTEXT THE FIELD IS
// DRAWN INTO, as `specs/assets.md` asks. The player maps its system's field
// across the whole backing store, so each instance is drawn under a
// transform that folds that box down onto the footprint its event calls for;
// the two maps compose so a particle lands exactly where the simulation put
// it. The seed option is left unset, so each play varies, and that variation
// is correct.
//
// WHY THE POOL SITS BESIDE THE STATE. A running particle player is not a
// value: it carries its own generator and its own live particles, and
// stepping it is exactly the write the state contract forbids. So the
// effects that are on screen live here, in the one place in this build that
// holds mutable data across a frame, and THE SIMULATION NEVER READS THEM.
// The traffic runs one way: a tick's rules raise spawns through `update`'s
// hooks, and `render` composites whatever is playing, advanced on the frame
// delta the state carries (`specs/assets.md`). Take the pool away and the
// game plays identically, minus the sparks.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem as SystemSpec } from "@test-cabinet/particle-runtime";
import type { ParticleSystem } from "./figures";

/** The square of logical units each system's field is folded down onto. */
const FOOTPRINT: Record<ParticleSystem, number> = {
  burst: 132,
  spark: 88,
  burnup: 124,
};

/** One live effect. The player is built lazily, on its first draw. */
interface Play {
  readonly system: ParticleSystem;
  readonly x: number;
  readonly y: number;
  /** Seconds the effect has run. */
  age: number;
  player: ParticleCanvasPlayer | null;
}

let systems: Partial<Record<ParticleSystem, SystemSpec>> = {};
let plays: Play[] = [];

/** Hand the pool the produced systems, once, and empty whatever was playing. */
export function installSystems(
  produced: Partial<Record<ParticleSystem, SystemSpec>>,
): void {
  systems = produced;
  plays = [];
}

/** Play `system` centered on the stage point `(x, y)`. */
export function spawnFx(system: ParticleSystem, x: number, y: number): void {
  if (systems[system] === undefined) return;
  plays.push({ system, x, y, age: 0, player: null });
  // A runaway scenario cannot pile up unbounded players.
  if (plays.length > 64) plays.shift();
}

/** Drop every live effect. */
export function clearFx(): void {
  plays = [];
}

/** How many effects are live, for the diagnostics overlay. */
export function liveFxCount(): number {
  return plays.length;
}

/**
 * Advance every effect by `dtSeconds` and composite it over the frame.
 * Composited on EVERY frame, a zero delta included: a frame that ran no tick
 * still redraws the whole field, and the effects must be laid back over it.
 */
export function drawFx(ctx: CanvasRenderingContext2D, dtSeconds: number): void {
  const canvas = ctx.canvas;
  if (!(canvas.width > 0) || !(canvas.height > 0)) return;
  for (const play of plays) {
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
  plays = plays.filter((play) => {
    const spec = systems[play.system];
    if (spec === undefined || play.player === null) return false;
    return (
      play.age * 1000 <= spec.durationMs || play.player.simulator.liveCount > 0
    );
  });
}
