// swarm/dive-bends-toward-player — a dive bends toward the ship, wherever it is.
//
// specs/swarm.md, "The dive": the path "bends toward the ship's current `x`, so
// it closes on the ship rather than running a fixed track, while staying wide
// enough to dodge", and "A dive's path answers where the ship stands. Two runs
// of the same dive from one slot, one flown at a ship parked at `SHIP_X_MIN` and
// one at a ship parked at `SHIP_X_MAX`, are different paths: at either end of the
// ship's lane, the run flown at the ship parked there comes at least `SHIP_W`
// nearer that end than the other run does. Each run also comes at least `SHIP_W`
// nearer the ship it was flown at than the slot it launched from stands. How much
// closer than that a dive presses is yours."
//
// WHAT IS READ IS THE ANSWER, NOT A DEPTH. Every dive here is flown twice from
// the SAME slot, with nothing changed between the two but where the ship stands,
// and what is asserted is the DIFFERENCE the ship's position made. That is the
// whole of what the specification fixes, and it is the property the item exists
// to detect: a fixed track — any fixed track, including one that converges on the
// middle of the field — flies the same path both times and so answers by nothing.
//
// WHY NOT A SHARE OF THE GAP. Because how much of the gap a dive can close is
// decided by geometry the specification leaves to the build: the closing is the
// path's lean times its vertical run, and specs/swarm.md lets a dive end "by
// turning back above `FIELD_BOTTOM`" as readily as by wrapping through it, so a
// shallow loop and a deep plunge need utterly different leans to close the same
// share. A share would have graded the depth of the loop the build chose. The
// difference two ship positions make does not: it is the same demand on either.
//
// AND THE CLOSING IS STILL READ, so the point cannot be passed by a path that
// merely twitches toward the ship: each of the two flown-at dives must end up
// nearer the ship than the slot it launched from stood, by at least the ship's
// own width. `SHIP_W` is the floor throughout for one reason — a movement smaller
// than the target is not aim, and the specification fixes no other figure here.
//
// THE SHIP IS PARKED BEFORE THE DRONE IS PUT INTO ITS DIVE, so the build lays its
// path out knowing where the ship is.
//
// The drone dives with travel on and firing off, so nothing it would shoot
// reaches the ship, and the ship's contact test is off through `startPosed`, so
// a dive that presses all the way home neither costs a life nor stops the wave.
// The two dives the replay carries are flown first and unchanged, so the picture
// is the same pair of runs the item has always shown.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FIELD_TOP, SHIP_W, SHIP_X_MAX, SHIP_X_MIN, slotX } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { traceDive } from "./flight";

/** The stage the dive is posed at: the first, a standard wave's. */
const STAGE = 1;

/**
 * How far apart two readings must sit for the difference to be read as an answer
 * to the ship rather than as the same path twice, in logical units.
 *
 * `SHIP_W` (`40`), the ship's own drawn width, and it is a FLOOR on a difference
 * rather than a target: specs/swarm.md fixes how much of the gap a dive closes
 * nowhere, and deliberately, so nothing here grades the depth of the loop a build
 * chose. What it does say is that the path answers the ship's actual position by
 * at least the ship's own width — a movement smaller than the target is not aim.
 */
const ANSWER_MIN = SHIP_W;

/**
 * How long each dive is watched, in frames.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds", so this is the
 * whole span a dive may occupy. The watch stops itself the moment the drone
 * leaves phase `diving`, which is sooner on any build whose dives end.
 */
const DIVE_FRAMES = framesFor(8);

/** Where the diver starts: the grid's outermost columns, top row. */
const FROM_RIGHT = { x: slotX(8), y: FIELD_TOP + 76 } as const;
const FROM_LEFT = { x: slotX(0), y: FIELD_TOP + 76 } as const;

/** The nearest a flown path ever came to a position in the ship's lane. */
function reach(path: readonly number[], target: number): number {
  return Math.min(...path.map((x) => Math.abs(x - target)));
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("bends its dive toward the ship parked at either end of its lane", async () => {
  await startPosed(harness, { stage: STAGE });

  /** Fly one dive from `at` with the ship parked at `shipX`, and keep its path. */
  const dive = async (
    shipX: number,
    at: { x: number; y: number },
  ): Promise<number[]> => {
    await harness.debug.clearDrones();
    await harness.debug.setShipX(shipX);
    const id = await poseDrone(harness, "shard", at.x, at.y, {
      phase: "diving",
      travel: true,
    });
    const trace = await traceDive(harness, id, DIVE_FRAMES);
    return trace.samples.map((sample) => sample.x);
  };

  // The two dives the replay carries, flown first and unchanged: the same dive
  // flown at a ship parked left and then at a ship parked right.
  let rightAtLeft: number[] = [];
  let leftAtRight: number[] = [];
  await captureReplay(harness, "bent", async () => {
    rightAtLeft = await dive(SHIP_X_MIN, FROM_RIGHT);
    leftAtRight = await dive(SHIP_X_MAX, FROM_LEFT);
  });

  // And their controls: the same two slots flown again with the ship moved to the
  // other end of its lane, which is the only thing that differs between a run and
  // its control.
  const rightAtRight = await dive(SHIP_X_MAX, FROM_RIGHT);
  const leftAtLeft = await dive(SHIP_X_MIN, FROM_LEFT);

  // Each dive closes on the ship it was flown at, by more than the ship is wide.
  assertLessThanOrEqual(
    reach(rightAtLeft, SHIP_X_MIN),
    Math.abs(FROM_RIGHT.x - SHIP_X_MIN) - ANSWER_MIN,
    `the closest the dive from x ${String(FROM_RIGHT.x)} ever came to a ship ` +
      `parked at SHIP_X_MIN (${String(SHIP_X_MIN)}) at stage ` +
      `${String(STAGE)}, against the gap it opened with less the ship's own ` +
      `width — a dive closes on the ship (specs/swarm.md)`,
  );
  assertLessThanOrEqual(
    reach(leftAtRight, SHIP_X_MAX),
    Math.abs(FROM_LEFT.x - SHIP_X_MAX) - ANSWER_MIN,
    `the closest the dive from x ${String(FROM_LEFT.x)} ever came to a ship ` +
      `parked at SHIP_X_MAX (${String(SHIP_X_MAX)}) at stage ` +
      `${String(STAGE)}, against the gap it opened with less the ship's own ` +
      `width — a dive closes on the ship (specs/swarm.md)`,
  );

  // And each answers WHERE the ship is: from either slot, the run flown at a ship
  // parked at one end comes nearer that end than the run flown at the other does.
  // A fixed track flies both runs identically and answers by nothing.
  assertLessThanOrEqual(
    reach(rightAtLeft, SHIP_X_MIN),
    reach(rightAtRight, SHIP_X_MIN) - ANSWER_MIN,
    `the closest the dive from x ${String(FROM_RIGHT.x)} came to SHIP_X_MIN ` +
      `(${String(SHIP_X_MIN)}) with the ship parked there, against how close ` +
      "the same dive came to that spot with the ship parked at the far end " +
      "less the ship's own width — the bend answers where the ship is, which a " +
      "fixed track cannot (specs/swarm.md)",
  );
  assertLessThanOrEqual(
    reach(rightAtRight, SHIP_X_MAX),
    reach(rightAtLeft, SHIP_X_MAX) - ANSWER_MIN,
    `the closest the dive from x ${String(FROM_RIGHT.x)} came to SHIP_X_MAX ` +
      `(${String(SHIP_X_MAX)}) with the ship parked there, against how close ` +
      "the same dive came to that spot with the ship parked at the far end " +
      "less the ship's own width — the bend answers where the ship is, which a " +
      "fixed track cannot (specs/swarm.md)",
  );
  assertLessThanOrEqual(
    reach(leftAtRight, SHIP_X_MAX),
    reach(leftAtLeft, SHIP_X_MAX) - ANSWER_MIN,
    `the closest the dive from x ${String(FROM_LEFT.x)} came to SHIP_X_MAX ` +
      `(${String(SHIP_X_MAX)}) with the ship parked there, against how close ` +
      "the same dive came to that spot with the ship parked at the far end " +
      "less the ship's own width — the bend answers where the ship is, which a " +
      "fixed track cannot (specs/swarm.md)",
  );
  assertLessThanOrEqual(
    reach(leftAtLeft, SHIP_X_MIN),
    reach(leftAtRight, SHIP_X_MIN) - ANSWER_MIN,
    `the closest the dive from x ${String(FROM_LEFT.x)} came to SHIP_X_MIN ` +
      `(${String(SHIP_X_MIN)}) with the ship parked there, against how close ` +
      "the same dive came to that spot with the ship parked at the far end " +
      "less the ship's own width — the bend answers where the ship is, which a " +
      "fixed track cannot (specs/swarm.md)",
  );
});
