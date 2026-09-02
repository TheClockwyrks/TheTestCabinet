// bullets — taking exactly one shot. Local to this group.
//
// WHY THIS IS HERE AND NOT IN THE HARNESS. The harness already carries `tap`,
// which presses a key, runs a frame, releases it and runs a second frame, and
// that is the right shape for every check that only needs a press to have
// happened. Three items in this group are about WHERE AND HOW FAST A ROUND
// LEAVES, and for those the second frame is a tick of flight between the launch
// and the reading — `520` units per second of it, thirty times the ship's own
// radius over the second tick. So the gun is driven here instead: the key goes
// down, exactly ONE tick runs, and the key comes up.
//
// ONE TICK IS ENOUGH FOR BOTH READINGS OF THE KEY. `specs/controls.md` reads
// firing "as a press and as a hold", so a build may answer the armed edge or the
// held value. Inside the single frame this runs, the key is BOTH freshly pressed
// and down, so either reading takes the shot, and the key is released before any
// later frame so neither reading can take a second one.
//
// AND IT LEAVES THE TICK ORDER OPEN. `specs/simulation.md` fixes the order of
// work inside a tick but does not say where in it the gun fires, so after this
// one tick a conforming round is either standing at the nose (a build that fires
// after the tick's position step) or one tick of its own velocity along from it
// (a build that fires before it). Both are conforming, and a check that reads a
// launch reconstructs both; see {@link launchCandidates}.
//
// NO THRESHOLD LIVES HERE. What counts as the nose, and how near the launch
// velocity must fall to the specified vector, are each check's own figures.

import { TICK_DT } from "../constants";
import { separation, wrap, type Point } from "../geometry";
import { keyFor, type Harness } from "../harness";

/**
 * The action `specs/controls.md` binds the gun to.
 *
 * `a` in both variants: under `base` the `b` action fires as well, and under
 * `warhead` it launches the torpedo instead, so `a` is the one action that means
 * "fire the gun" whichever variant is being graded.
 */
export const FIRE_ACTION = "a" as const;

/** Press the fire key, run exactly one tick with it down, and release it. */
export async function fireOnce(h: Harness): Promise<void> {
  const key = keyFor(FIRE_ACTION);
  h.hold(key);
  await h.advance(1);
  h.release(key);
}

/** One reading of where a round was launched from, and how it was arrived at. */
export interface LaunchCandidate {
  /** The launch point, on the field. */
  at: Point;
  /** How the reading was taken, for the failure message. */
  when: string;
}

/**
 * The two launch points the tick order leaves open for a round read one tick
 * after the key went down: where the snapshot puts it, and where it stood one
 * tick of its own reported velocity earlier.
 *
 * The second is EXACT rather than approximate. `specs/simulation.md` gives a
 * body its accelerations (step 3) before it advances its position (step 4), so
 * the position a tick leaves behind is the one it started from plus the velocity
 * that same tick ended with — which is the velocity the snapshot reports.
 */
export function launchCandidates(round: {
  x: number;
  y: number;
  vx: number;
  vy: number;
}): LaunchCandidate[] {
  return [
    { at: { x: round.x, y: round.y }, when: "as the snapshot reports it" },
    {
      at: wrap({
        x: round.x - round.vx * TICK_DT,
        y: round.y - round.vy * TICK_DT,
      }),
      when: "one tick of its own velocity earlier",
    },
  ];
}

/** How far a launch point sits from the ship's centre, and how far along its facing. */
export interface LaunchReading extends LaunchCandidate {
  /** The shortest wrapped distance from the ship's centre, in logical units. */
  reach: number;
  /** The component of that separation along the facing; negative is behind. */
  ahead: number;
}

/**
 * The nearer of the two {@link launchCandidates} to the ship's centre, measured
 * against the facing the shot was taken on.
 *
 * The NEARER is taken because a build is entitled to either tick order and must
 * be judged on the launch point it actually chose. A build that put its round
 * anywhere but the nose is outside the specification's bound under both.
 */
export function launchReading(
  round: { x: number; y: number; vx: number; vy: number },
  centre: Point,
  facing: number,
): LaunchReading {
  const along = { x: Math.cos(facing), y: Math.sin(facing) };
  const readings = launchCandidates(round).map((candidate) => {
    const delta = separation(centre, candidate.at);
    return {
      ...candidate,
      reach: Math.hypot(delta.x, delta.y),
      ahead: delta.x * along.x + delta.y * along.y,
    };
  });
  return readings.reduce((best, one) => (one.reach < best.reach ? one : best));
}
