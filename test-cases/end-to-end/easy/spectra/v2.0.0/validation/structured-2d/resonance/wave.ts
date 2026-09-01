// Spectra — resonance/wave: what every `resonance/discharge-*` point needs from
// the wave itself. LOCAL TO THIS GROUP.
//
// specs/resonance.md gives the discharge one shape, and every point in this
// directory poses it the same way: the meter is put at `RESONANCE_MAX` with
// `setResonance` and the discharge action is driven through its own key, because
// specs/instrumentation.md gives the surface no operation that discharges — "A
// caller checking the discharge poses the meter and drives the discharge action;
// the wave that follows is the outcome". So what expands is always the build's
// own wave, and what it takes is always the build's own rules.
//
// THE SECOND THING HERE IS FOR THE TWO POINTS THAT ASSERT A SURVIVAL. "A drone in
// phase `formation` | Nothing" and "One of the player's bullets | Nothing" are
// requirements a build that never starts a wave at all satisfies by accident, so
// a check that reads only "it is still there" is vacuous on exactly the build it
// most needs to fail. {@link everReached} closes that: specs/resonance.md says
// the wave "reaches a thing when that thing's center lies inside the wave's
// current radius", and both of those figures — the radius, and the centre — are
// reported by `snapshot`, so a check can establish that the wave really did sweep
// over the thing it then finds intact. It is read as a PRECONDITION, never as the
// verdict.
//
// THE THIRD IS THE BYSTANDER, which nine of this group's points need for a reason
// that has nothing to do with resonance: specs/stages.md clears a standard stage
// "in the moment the last drone of its wave is destroyed", and this group
// destroys drones for a living. See {@link poseBystander}.
//
// It lives beside the checks that use it rather than in the shared harness next
// door because only this group poses a field this way. Like everything there it
// fixes ARRANGEMENT and nothing else, and holds no threshold and asserts nothing:
// a caller states its own span in its own file, and reads its own verdict.

import {
  BINDINGS,
  FIELD_LEFT,
  FIELD_TOP,
  RESONANCE_MAX,
} from "../../src/constants";
import {
  SHIP_LANE_Y,
  distanceBetween,
  poseDrone,
  type Band,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The one key specs/controls.md binds the `discharge` action to. */
export const DISCHARGE_KEY = BINDINGS.discharge[0];

/**
 * The two bands everything in Spectra is one of (specs/bands.md).
 *
 * Named here because three of this group's points sweep both of them — the wave
 * is band-blind, so a build filtering by band has to fail on one — and the order
 * is only the order the two are read in.
 */
export const BANDS: readonly Band[] = ["cyan", "magenta"];

/**
 * Where {@link poseBystander} stands: inside the play field, in the corner
 * furthest from every place this group poses a thing the wave is about.
 */
export const BYSTANDER_AT = { x: FIELD_LEFT + 40, y: FIELD_TOP + 40 } as const;

/**
 * Pose one inert Shard out of the way, so the live wave still holds a drone.
 *
 * WHAT IT IS FOR. specs/stages.md clears a standard stage "in the moment the last
 * drone of its wave is destroyed", and only a wave that has had a drone removed
 * can clear. A build is free to read "its wave" as the drones standing on the
 * field — under which reading a scenario that destroys the only drone it posed
 * clears the stage in that same frame, pays `SCORE_STAGE_CLEAR` into the score,
 * and opens the stage-cleared interstitial over the reading the check was about
 * to take. That is the build behaving correctly, and it is simply not what a
 * check about the meter or about what a wave takes is asking. A bystander leaves
 * a drone standing, so the wave carries on whichever reading the build took.
 *
 * It is a prop like any other {@link poseDrone} — every faculty off, in phase
 * `formation`, which is also the phase a discharge wave spares
 * (specs/resonance.md) — so it holds its corner and takes no part. A check that
 * poses one accounts for it when it counts drones.
 */
export function poseBystander(h: Harness): number {
  return poseDrone(h, "shard", BYSTANDER_AT.x, BYSTANDER_AT.y, {
    phase: "formation",
  });
}

/**
 * Fill the meter to `RESONANCE_MAX` and take the discharge action once.
 *
 * The meter is POSED — specs/instrumentation.md gives `setResonance` for exactly
 * this — and the action is the real registered key, pressed and released so the
 * press edge specs/controls.md requires is the one the build reads. The wave
 * itself is never posed.
 *
 * On return the action's own frame has run, so the wave a conforming build
 * started is live and the caller's own span starts from here.
 */
export async function release(h: Harness): Promise<void> {
  h.debug.setResonance(RESONANCE_MAX);
  await h.tap(DISCHARGE_KEY);
}

/**
 * Run `frames` frames ONE AT A TIME, keeping the snapshot each one left.
 *
 * A batched `advance` reaches the same state and says nothing about the radii the
 * wave passed through on the way, which is the whole of what {@link everReached}
 * reads.
 */
export async function sweep(
  h: Harness,
  frames: number,
): Promise<SpectraSnapshot[]> {
  const samples: SpectraSnapshot[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    await h.advance(1);
    samples.push(h.snapshot());
  }
  return samples;
}

/**
 * Whether the live wave's radius ever covered the centre `locate` reports.
 *
 * specs/resonance.md: the wave "is a circle centered on the ship" and "reaches a
 * thing when that thing's center lies inside the wave's current radius". Both
 * centres are taken from the SAME sample, so a thing that moves is judged where
 * it stood when the radius was read, and a sample carrying no live wave counts
 * for nothing whatever radius it reports.
 */
export function everReached(
  samples: readonly SpectraSnapshot[],
  locate: (snapshot: SpectraSnapshot) => { x: number; y: number } | undefined,
): boolean {
  return samples.some((snapshot) => {
    if (!snapshot.discharge.active) return false;
    const at = locate(snapshot);
    if (at === undefined) return false;
    return (
      distanceBetween(at, { x: snapshot.ship.x, y: SHIP_LANE_Y }) <=
      snapshot.discharge.radius
    );
  });
}
