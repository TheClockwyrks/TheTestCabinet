// bullets — reading a shot the gun itself took. Local to this group.
//
// WHY THIS IS HERE AND NOT IN THE HARNESS. Driving the gun needs nothing this
// group could add: the harness's `tapAction(h, "a")` presses the fire key for
// exactly one frame and lets it up, which is one shot under either reading
// `specs/controls.md` allows. What three items in this group DO need — and no
// other group in this case does — is the arithmetic that turns a round read one
// tick after that press into a statement about where it was launched FROM, and
// that lives beside the checks that read it.
//
// THE TICK ORDER IS OPEN, AND THIS IS WHAT MAKES IT SO. `specs/simulation.md`
// fixes the order of work inside a tick but does not say where in it the gun
// fires, so after the single tick a press is worth a conforming round is either
// standing at the nose (a build that fires after that tick's position step) or
// one tick of its own velocity along from it (a build that fires before it).
// Both are conforming, and a check cannot look inside a tick — the shot only
// exists once the tick that took it has run — so {@link launchCandidates}
// reconstructs BOTH readings and {@link launchReading} takes the nearer. A build
// that put its round anywhere but the nose is outside the specification's bound
// under both.
//
// THE RECONSTRUCTION IS EXACT RATHER THAN APPROXIMATE. `specs/simulation.md`
// gives a body its accelerations before it advances its position, so the
// position a tick leaves behind is the one it started from plus the velocity
// that same tick ended with — which is the velocity the snapshot reports.
//
// NO THRESHOLD LIVES HERE. What counts as the nose, and how near a launch
// velocity must fall to the specified vector, are each check's own figures.

import { TICK_DT } from "../../src/constants";
import { shortestSeparation, wrapPoint, type Vec } from "../geometry";

/**
 * The action `specs/controls.md` binds the gun to.
 *
 * `a` in both variants: under `base` the `b` action fires the gun as well, and
 * under `warhead` it launches the torpedo instead, so `a` is the one action that
 * means "fire the gun" whichever variant is being graded.
 */
export const FIRE_ACTION = "a" as const;

/** One reading of where a round was launched from, and how it was arrived at. */
export interface LaunchCandidate {
  /** The launch point, on the field. */
  at: Vec;
  /** How the reading was taken, for the failure message. */
  when: string;
}

/**
 * The two launch points the tick order leaves open for a round read one tick
 * after the fire key went down: where the snapshot puts it, and where it stood
 * one tick of its own reported velocity earlier.
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
      at: wrapPoint({
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
 * be judged on the launch point it actually chose.
 */
export function launchReading(
  round: { x: number; y: number; vx: number; vy: number },
  centre: Vec,
  facing: number,
): LaunchReading {
  const along = { x: Math.cos(facing), y: Math.sin(facing) };
  const readings = launchCandidates(round).map((candidate) => {
    const delta = shortestSeparation(centre, candidate.at);
    return {
      ...candidate,
      reach: Math.hypot(delta.x, delta.y),
      ahead: delta.x * along.x + delta.y * along.y,
    };
  });
  return readings.reduce((best, one) => (one.reach < best.reach ? one : best));
}
