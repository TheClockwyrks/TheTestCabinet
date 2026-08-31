// torpedo — putting a torpedo in flight, reading the charge, and locating a
// launch. Local to this group.
//
// WHY THIS IS HERE AND NOT IN `../harness.ts`. The harness owns what the whole
// project shares, and it can only reach the surface EVERY variant has: `addRock`,
// `addBullet`, `addSaucer`, `startPlaying`. Everything below reaches
// `addTorpedo`, `setTorpedoHoming` and the snapshot's `torpedoCharge` — members
// `specs/instrumentation.md` owes a `warhead` build alone — and is wanted by the
// twenty-one checks in this directory, which never load against a `base` build.
// `detonation/scenario.ts` keeps its own placements for the same reason, and for
// the same reason neither reaches into the other: what that group needs is a
// torpedo flown INTO a body, and what this one needs is a torpedo flown to be
// read.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here poses or reads. Every
// tolerance stays in the check that asserts it, derived there from the figure
// `specs/` fixes for it.
//
// THE READINGS COME IN THE `require...` FORM the harness's own do, and for the
// same reason: `../surface.ts` declares every torpedo member OPTIONAL so one
// harness serves both workspaces, which leaves a check free to dereference one
// that is not there and crash. A crashed suite is reported as a build that failed
// to expose its debug surface, which is a different and much worse verdict than
// the true one — that a `warhead` build is missing something its specification
// requires.

import { TICK_DT, TORPEDO_RECHARGE, TORPEDO_SPEED } from "../../src/constants";
import { fail } from "../assert";
import { shortestSeparation, wrapPoint, type Vec } from "../geometry";
import { torpedoesOf, type Harness, type ShatterSnapshot } from "../harness";
import { requireOp } from "../surface";

/**
 * The action `specs/controls.md` binds the torpedo to.
 *
 * `b`, which under `warhead` is bound to `KeyF` and launches the torpedo, where
 * under `base` the same action fires the gun. `a` is the gun under both, so a
 * check in this directory never presses it. `specs/controls.md` reads the torpedo
 * "as a press alone: one launch per press, with no repeat while the key is held",
 * and the harness's `tapAction` is exactly one press.
 */
export const TORPEDO_ACTION = "b" as const;

/** One tick of a torpedo's travel at the specified speed, in logical units. */
export const TORPEDO_TICK_TRAVEL = TORPEDO_SPEED * TICK_DT;

/* -------------------------------------------------------------------------- */
/* Posing one                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One torpedo in flight at a logical field position on `heading`, and its id.
 *
 * `specs/instrumentation.md`: `addTorpedo(x, y, heading)` "Adds one torpedo in
 * flight, its centre at a logical field position, travelling at `TORPEDO_SPEED`
 * along `heading` in radians, with a full `TORPEDO_LIFE` and its guidance on.
 * Appended to `torpedoes`, fresh id." So the id is read off the last entry of the
 * roster, which is where an added torpedo lands.
 *
 * MOST CHECKS IN THIS GROUP POSE RATHER THAN LAUNCH. A posed torpedo is the
 * scenario reached directly: a check about the flight, the guidance or the
 * lifetime says nothing about the launch, and a build whose torpedo key does
 * nothing must lose `torpedo/the-torpedo-action-launches-one` and only that. The
 * four launch items are the ones that press the key.
 */
export function poseTorpedo(
  h: Harness,
  x: number,
  y: number,
  heading: number,
): number {
  requireOp(h.debug, "addTorpedo")(x, y, heading);
  const torpedoes = torpedoesOf(h.snapshot());
  if (torpedoes.length === 0) {
    fail(
      `addTorpedo(${x}, ${y}, ${heading}) to append a torpedo to the roster ` +
        `(specs/instrumentation.md)`,
      "the torpedo roster is empty",
    );
  }
  return torpedoes[torpedoes.length - 1].id;
}

/**
 * That torpedo's guidance held off, so it keeps the heading it was posed on.
 *
 * `specs/instrumentation.md`: `setTorpedoHoming(id, enabled)` "Gates that
 * torpedo's guidance alone: the forward-cone acquisition and the turn onto a
 * target. Off, it holds its heading. Its travel, its lifetime, and its impacts
 * run on." A check that is about the FLIGHT rather than the guidance turns it off,
 * so the only thing left that could turn the torpedo is the well — which is the
 * whole of `torpedo/flies-true-through-the-well`'s reading.
 */
export function holdItsHeading(h: Harness, id: number): void {
  requireOp(h.debug, "setTorpedoHoming")(id, false);
}

/* -------------------------------------------------------------------------- */
/* Standing the ship clear                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a check that FLIES a torpedo stands the ship: `(40, 360)`, against the
 * left edge on the star's row.
 *
 * `startPlaying` leaves the ship at the safe point `(640, 560)`, which is in the
 * middle of the lower half of the field — squarely among the lanes the flight and
 * guidance checks in this group fly along. Two things go wrong when a torpedo or
 * its target is posed on top of it.
 *
 * THE READING IS NO LONGER ISOLATED. `specs/collision.md` gives a torpedo and the
 * ship no interaction at all — "the torpedo passes through the ship, which is
 * unharmed, and stays in flight" — so on a conforming build the ship is scenery.
 * A build that got that row wrong loses `detonation/harmless-to-the-ship`, and a
 * scenario that flew its torpedo through the ship would make that one fault lower
 * the verdict on the cone, the turn rate and the lifetime as well.
 *
 * AND THE PICTURE IS UNREADABLE. A still that shows a rock drawn on top of the
 * ship tells a reviewer nothing about which body the torpedo turned toward.
 *
 * `(40, 360)` is at least `200` units from every lane and every body these checks
 * pose, by the shortest wrapped separation — including across the seams, which is
 * why it is not simply a corner. The ship is left at rest, and `specs/gravity.md`
 * never pulls it, so it stays there for the whole of any scenario.
 */
export const SHIP_CLEAR: Vec = { x: 40, y: 360 };

/**
 * The ship stood at {@link SHIP_CLEAR}, at rest.
 *
 * Called after `startPlaying` by every check in this group that flies a torpedo.
 * It changes nothing else about the ship: the facing and the charge are as
 * `startPlaying` left them, because no check that calls this reads either.
 */
export function standTheShipClear(h: Harness): void {
  h.debug.setShipPosition(SHIP_CLEAR.x, SHIP_CLEAR.y);
  h.debug.setShipVelocity(0, 0);
}

/* -------------------------------------------------------------------------- */
/* Reading the charge                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How far a POSED charge may read from the value `setTorpedoCharge` was handed,
 * as a fraction of the bar.
 *
 * One tick of the refill, `1 / 1200`. It is used only for the PRECONDITIONS in
 * this group — the reading that says a check's own arrangement took — never for a
 * figure a review item grades, which each check derives for itself from
 * `specs/weapons.md`. `specs/instrumentation.md` has `setTorpedoCharge` set the
 * stored charge, so a build that keeps it as a plain number reads back exactly
 * what it was given; the allowance is for one that keeps it as whole ticks of
 * `TORPEDO_RECHARGE` and rounds, which is a conforming way to hold a bar that
 * only ever moves a tick at a time.
 */
export const POSED_CHARGE_SLACK = TICK_DT / TORPEDO_RECHARGE;

/** The stored charge, hard-asserted to be a number the snapshot reports. */
export function requireCharge(
  snapshot: ShatterSnapshot,
  context?: string,
): number {
  const charge = snapshot.torpedoCharge;
  if (typeof charge !== "number" || Number.isNaN(charge)) {
    fail(
      context === undefined
        ? "the snapshot to report torpedoCharge, the stored charge from 0 to " +
            "1 (specs/instrumentation.md)"
        : `the snapshot to report torpedoCharge (${context}) ` +
            "(specs/instrumentation.md)",
      charge,
    );
  }
  return charge;
}

/** Whether the charge is full, hard-asserted to be the boolean the snapshot owes. */
export function requireReady(
  snapshot: ShatterSnapshot,
  context?: string,
): boolean {
  const ready = snapshot.torpedoReady;
  if (typeof ready !== "boolean") {
    fail(
      context === undefined
        ? "the snapshot to report torpedoReady, true exactly when the charge " +
            "is 1 (specs/instrumentation.md)"
        : `the snapshot to report torpedoReady (${context}) ` +
            "(specs/instrumentation.md)",
      ready,
    );
  }
  return ready;
}

/* -------------------------------------------------------------------------- */
/* Locating a launch                                                          */
/* -------------------------------------------------------------------------- */

/** One reading of where a torpedo was launched from, and how it was arrived at. */
export interface LaunchCandidate {
  /** The launch point, on the field. */
  at: Vec;
  /** How the reading was taken, for the failure message. */
  when: string;
}

/**
 * The two launch points the tick order leaves open for a torpedo read one tick
 * after the torpedo key went down: where the snapshot puts it, and where it stood
 * one tick of its own reported velocity earlier.
 *
 * `specs/simulation.md` fixes the order of work inside a tick but does not say
 * where in it a torpedo is launched, so a conforming build may create it before
 * that tick's position step and let it fly one tick, or after it and leave it
 * standing at the nose. A check cannot look inside a tick — the torpedo only
 * exists once the tick that launched it has run — so both readings are
 * reconstructed and {@link launchReading} takes the nearer. The reconstruction is
 * exact rather than approximate: a body is given its accelerations before it
 * advances, so the position a tick leaves behind is the one it started from plus
 * the velocity that same tick ended with, which is the velocity the snapshot
 * reports.
 */
export function launchCandidates(torpedo: {
  x: number;
  y: number;
  vx: number;
  vy: number;
}): LaunchCandidate[] {
  return [
    { at: { x: torpedo.x, y: torpedo.y }, when: "as the snapshot reports it" },
    {
      at: wrapPoint({
        x: torpedo.x - torpedo.vx * TICK_DT,
        y: torpedo.y - torpedo.vy * TICK_DT,
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
 * against the facing the torpedo left on.
 *
 * The NEARER is taken because a build is entitled to either tick order and must
 * be judged on the launch point it actually chose.
 */
export function launchReading(
  torpedo: { x: number; y: number; vx: number; vy: number },
  centre: Vec,
  facing: number,
): LaunchReading {
  const along = { x: Math.cos(facing), y: Math.sin(facing) };
  const readings = launchCandidates(torpedo).map((candidate) => {
    const delta = shortestSeparation(centre, candidate.at);
    return {
      ...candidate,
      reach: Math.hypot(delta.x, delta.y),
      ahead: delta.x * along.x + delta.y * along.y,
    };
  });
  return readings.reduce((best, one) => (one.reach < best.reach ? one : best));
}
