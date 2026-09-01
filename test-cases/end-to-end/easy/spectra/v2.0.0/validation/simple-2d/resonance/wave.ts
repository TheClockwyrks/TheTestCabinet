// resonance/wave — what every check in this group builds on: the discharge as a
// player takes it, and the two readings a survival needs.
//
// It lives beside the checks that use it rather than in the shared harness next
// door because only the `resonance` group poses a field this way. Like everything
// there it fixes GEOMETRY and the sequence a scenario is arranged by, and never a
// threshold: every distance, tolerance, span and bound a check asserts is stated
// in that check, derived from the figure `specs/` fixes for it.
//
// THE DISCHARGE IS ALWAYS TAKEN, NEVER POSED. `specs/instrumentation.md` gives
// the surface no operation that discharges — "A caller checking the discharge
// poses the meter and drives the discharge action; the wave that follows is the
// outcome, so `discharge.active` and `discharge.radius` are reported and never
// set" — so every check here fills the meter with `setResonance` and presses the
// key `specs/controls.md` binds. What expands is the build's own wave, and what
// it takes is the build's own rules.
//
// THE SECOND THING HERE IS FOR THE TWO CHECKS THAT ASSERT A SURVIVAL. "A drone in
// phase `formation` | Nothing" and "One of the player's bullets | Nothing" are
// requirements a build whose discharge does nothing at all satisfies by accident,
// so a check that read only "it is still there" would be vacuous on exactly the
// build it most needs to fail. {@link everReached} closes that: `specs/resonance.md`
// says the wave "reaches a thing when that thing's center lies inside the wave's
// current radius", and both of those figures — the radius, and the centre — are
// reported by `snapshot`, so a check can establish that the wave really did sweep
// over the thing it then finds intact. It is read as a PRECONDITION, never as the
// verdict.

import { BINDINGS, FIELD_LEFT, FIELD_TOP, SHIP_Y } from "../../src/constants";
import { fail } from "../assert";
import {
  distance,
  lastBullet,
  poseDrone,
  type Band,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The one key `specs/controls.md` binds the discharge action to. */
export const DISCHARGE_KEY = BINDINGS.discharge[0];

/**
 * Fill the meter to `full` and take the discharge action once.
 *
 * The meter is POSED — `specs/instrumentation.md` gives `setResonance` for
 * exactly this — and the action is a real key press through the engine's own
 * input, armed and released inside one frame, so the press edge
 * `specs/controls.md` requires is one a build reading the action either
 * conformant way can see. The wave itself is never posed.
 *
 * On return the action's own frame has run, so the wave a conforming build
 * started is live and the caller's own span starts from here.
 *
 * `full` is the caller's, because the two checks that take the action at a meter
 * that is NOT full — `resonance/discharge-locked` — state their own figure and
 * derive it from `RESONANCE_MAX` themselves.
 */
export async function release(h: Harness, full: number): Promise<void> {
  h.debug.setResonance(full);
  await h.tap(DISCHARGE_KEY);
}

/**
 * Run `ticks` frames ONE AT A TIME, keeping the snapshot each one left.
 *
 * A batched `advance` reaches the same state and says nothing about the radii the
 * wave passed through on the way, which is the whole of what {@link everReached}
 * reads.
 */
export async function sweep(
  h: Harness,
  ticks: number,
): Promise<SpectraSnapshot[]> {
  const samples: SpectraSnapshot[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    await h.advance(1);
    samples.push(h.snapshot());
  }
  return samples;
}

/**
 * Whether the live wave's radius ever covered the centre `locate` reports.
 *
 * `specs/resonance.md`: the wave "is a circle centered on the ship" and "reaches
 * a thing when that thing's center lies inside the wave's current radius". Both
 * centres are taken from the SAME sample, so a thing that moves is judged where
 * it stood when the radius was read, and a sample carrying no live wave counts
 * for nothing whatever radius it reports.
 */
export function everReached(
  samples: readonly SpectraSnapshot[],
  locate: (snapshot: SpectraSnapshot) => { x: number; y: number } | null,
): boolean {
  return samples.some((snapshot) => {
    if (!snapshot.discharge.active) return false;
    const at = locate(snapshot);
    if (at === null) return false;
    return (
      distance(at, { x: snapshot.ship.x, y: SHIP_Y }) <=
      snapshot.discharge.radius
    );
  });
}

/**
 * Where {@link poseBystander} stands: inside the play field, in the corner
 * furthest from the ship's lane and from every place this group poses a drone it
 * is about to destroy.
 */
export const BYSTANDER_AT = { x: FIELD_LEFT + 40, y: FIELD_TOP + 40 } as const;

/**
 * Pose one inert Shard out of the way, so the live wave still holds a drone.
 *
 * WHAT IT IS FOR. A stage clears in the moment the last drone of its wave is
 * destroyed, and only a wave that has had a drone removed can clear
 * (`specs/stages.md`). A check here that destroys every drone it posed therefore
 * leaves an empty wave that HAS had one removed, and a conformant build opens the
 * stage-cleared interstitial underneath the reading — correct behaviour, and
 * simply not what a check about the meter or about what a wave takes is asking
 * about: the still becomes the interstitial's, and the frames driven afterwards
 * are the interstitial's rather than the wave's.
 *
 * A bystander leaves a drone standing, so the wave carries on whichever reading
 * the build took of "its wave" and the scenario under test runs to its end. A
 * check that poses one accounts for it when it counts drones.
 *
 * It is a prop like any other {@link poseDrone} — every faculty off, in phase
 * `formation`, which is also the phase a discharge wave spares
 * (`specs/resonance.md`) — so it holds its corner and takes no part.
 */
export function poseBystander(h: Harness): number {
  return poseDrone(h, "shard", BYSTANDER_AT.x, BYSTANDER_AT.y, {
    phase: "formation",
  });
}

/**
 * Put one enemy bullet `above` units over the ship's centre, and hand back its id.
 *
 * `specs/instrumentation.md` gives `addEnemyBullet` for exactly this, so nothing
 * here depends on a dive crossing `DIVE_FIRE_Y` or on which kind fires how many
 * shots — those are `swarm`'s and `drones`'. The bullet is placed on the ship's
 * own `x` so its fall carries it into the hull, and it falls at
 * `ENEMY_BULLET_SPEED` under the build's own stepping. What happens when it
 * arrives is the build's own contact and band rules.
 *
 * The roster is counted rather than assumed, so a build whose `addEnemyBullet`
 * appends nothing is named here instead of failing the caller's reading later.
 */
export function poseEnemyBulletAbove(
  h: Harness,
  band: Band,
  above: number,
): number {
  const before = h.snapshot();
  h.debug.addEnemyBullet(before.ship.x, SHIP_Y - above, band);
  const added = h.snapshot();
  if (added.bullets.length !== before.bullets.length + 1) {
    fail(
      "addEnemyBullet to append one bullet to the roster " +
        "(specs/instrumentation.md)",
      `the roster went from ${String(before.bullets.length)} to ` +
        `${String(added.bullets.length)} bullets`,
    );
  }
  return lastBullet(added).id;
}

/**
 * Put one of the player's bullets at `(x, y)` carrying `band`, and hand back its
 * id.
 *
 * The arrangement half of `harness.ts`'s `fireAt` without its drive, for the two
 * checks that place a bullet where it already is rather than flying one into
 * something: `specs/instrumentation.md`'s "a caller that simply wants a bullet in
 * flight places one with `addPlayerBullet`".
 */
export function poseShot(h: Harness, x: number, y: number, band: Band): number {
  const before = h.snapshot();
  h.debug.addPlayerBullet(x, y, band);
  const added = h.snapshot();
  if (added.bullets.length !== before.bullets.length + 1) {
    fail(
      "addPlayerBullet to append one bullet to the roster " +
        "(specs/instrumentation.md)",
      `the roster went from ${String(before.bullets.length)} to ` +
        `${String(added.bullets.length)} bullets`,
    );
  }
  return lastBullet(added).id;
}
