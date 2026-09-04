// Meltdown — reading the cue bus, for the `audio/*` points. GROUP-LOCAL.
//
// One sentence in `specs/audio.md` governs all twelve of these points: "A cue is
// raised by the frame that resolves the event it answers, and it is played from
// the frame loop, so a cue always names one real frame." So every audio check is
// the same measurement in a different scenario — drive the REAL path the event
// resolves on, then read what played ON that frame against what played on the
// frames BEFORE it.
//
// THE FRAMES BEFORE ARE THE HALF A BUILD CANNOT FAKE. A build that blips a cue
// every frame sounds on the event's frame too, and passes any check that asks
// only "did the cue ever play". It fails on the quiet that should have come
// first. `harness.ts`'s `watchCues` stamps every play with `engine.frame().count`
// as it arrives — the engine publishes `cue:played` synchronously from inside
// `audio.play`, so the stamp is the frame that was running — and the two readings
// below are that stamp split at the event's own frame.
//
// NO OPERATION OF THE DEBUG SURFACE PLAYS A CUE, and none can
// (`specs/instrumentation.md`): under this engine a pose is a pure
// `(state, ...args) => nextState` transform driven through `engine.apply`, which
// holds no `api` and so can reach no audio bus at all. A debug act therefore names
// no cue frame, and every scenario here reaches its event the way a player reaches
// it — a real shot, a real kill, a real leak, a real clear, a real press.

import { poseWalker, type Harness, type TimedCue } from "../harness";
import { tileCentre } from "../geometry";

/** Every cue that played on `frame`, by name, in the order they played. */
export function playedOn(played: readonly TimedCue[], frame: number): string[] {
  return played.filter((cue) => cue.frame === frame).map((cue) => cue.cue);
}

/** Every cue that played on a frame BEFORE `frame`, by name, oldest first. */
export function playedBefore(
  played: readonly TimedCue[],
  frame: number,
): string[] {
  return played.filter((cue) => cue.frame < frame).map((cue) => cue.cue);
}

/** Every play of the cue named `name`, oldest first. */
export function playsOf(played: readonly TimedCue[], name: string): TimedCue[] {
  return played.filter((cue) => cue.cue === name);
}

/** The distinct cue names in a recording, sorted, so two runs compare as sets. */
export function namesIn(played: readonly TimedCue[]): string[] {
  return [...new Set(played.map((cue) => cue.cue))].sort();
}

/**
 * The tile a leaker is posed on: one orthogonal step short of the right
 * exhaust's opening.
 *
 * `specs/floor.md` opens the right exhaust onto `(49, 16)` through `(49, 19)`,
 * and `specs/mazing.md` removes a unit "when the tile its centre occupies is one
 * of its assigned exhaust's opening tiles". Column `48` is therefore the last tile
 * that is still on the floor, and a unit posed there REACHES the exhaust by
 * walking into it rather than by being placed on it — which is the event
 * `audio/leak-cue` is about, and the transition the wave-clear, victory and
 * game-over items each ride in on.
 */
export const APPROACH = { col: 48, row: 17 } as const;

/**
 * A Mote walking the last tile to the right exhaust, and its id.
 *
 * `poseWalker` enters it through `addUnit("mote", "left")`, which puts it into the
 * same pathing the spawner uses and assigns it the left vent's fixed opposite
 * exhaust, the right one (`specs/floor.md`), so the unit this returns is one the
 * game itself could have released. Its position alone is posed; its motion, its
 * route, its speed and its leak value are the build's.
 */
export function poseLeaker(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCentre(APPROACH.col, APPROACH.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}
