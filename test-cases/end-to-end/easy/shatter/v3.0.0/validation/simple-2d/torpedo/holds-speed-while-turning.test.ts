// torpedo/holds-speed-while-turning — a turning torpedo does not slow down or speed
// up.
//
// `specs/weapons.md`, "The flight": the Speed row is `TORPEDO_SPEED` (`420`), "held
// constant whether or not it is turning", and "The guidance" says the same from the
// other end: with a target the torpedo "turns its heading toward that target's
// current position at up to `TORPEDO_TURN` (`160` degrees per second), keeping its
// speed." `speed` reads the figure off straight flight; this reads it off every
// tick of a turn.
//
// EVERY TICK IS READ, NOT THE ENDS. A build that steers by adding a lateral
// acceleration to its velocity rather than by turning a heading gains speed through
// the turn; one that turns its heading but rebuilds its velocity from a per-frame
// delta rather than from the tick loses it; one that eases into the turn and back
// out dips in the middle and recovers by the end. Reading the two ends alone would
// pass all three. Each tick's speed is the distance the torpedo actually covered
// over that tick, so what is graded is the travel rather than the velocity the
// build reports.
//
// THE TURN IS A REAL PURSUIT, POSED SO IT LASTS. The target is a Large `10` degrees
// off the torpedo's heading — comfortably inside the `TORPEDO_CONE` (`15` degrees)
// half-angle, so this item is not deciding the cone's edge, which is
// `cone-half-angle`'s — and only `200` units ahead. Closing at `420` units per
// second the bearing swings faster and faster as the range shortens, so the torpedo
// is still turning when it arrives, and every sample is taken while the heading is
// moving.
//
// THE TURN IS CONFIRMED BEFORE THE SPEEDS ARE JUDGED. "Its speed stays 420
// throughout the turn" is vacuous against a build that never turns at all: such a
// build flies straight past at a constant `420` and would score the item it fails.
// The swept heading is asserted first, and a build with no guidance fails that with
// the turn named.
//
// THE WHOLE SCENARIO IS DOWN THE FIELD'S LEFT COLUMN, more than `400` units from the
// star, so the well moves the rock by under a unit over the flight and moves the
// torpedo not at all (`specs/gravity.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { DEG, TORPEDO_SPEED } from "../constants";
import { angleGap, degrees } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { COLUMN, HEADING_DOWN, flyTorpedo, pointAt } from "./scene";

/** How far off the torpedo's heading the target is posed, in degrees. */
const OFF_AXIS_DEG = 10;

/** How far ahead the target is posed, in units: half a second of closing. */
const RANGE = 200;

/** How long the turn is watched for, in ticks: past the arrival at that range. */
const WATCH_TICKS = ticksFor(0.7);

/**
 * How far a tick's speed may sit from `TORPEDO_SPEED`, in units per second.
 *
 * Three per cent of `420`, the manifest's own allowance: `12.6`. It is not room on
 * the rule — the speed is held constant — but the honest floor for a reading taken
 * from two positions a hundred and twentieth of a second apart. A build that adds a
 * steering acceleration is out by far more within a few ticks of the turn.
 */
const TOLERANCE = 0.03 * TORPEDO_SPEED;

/**
 * The least the heading must have swept for the scenario to be a turn at all, in
 * radians.
 *
 * Five degrees: half the `10` the target is posed off the heading, so a build that
 * turns onto its target at any rate at all clears it, and a build that never turns
 * cannot. It is the control, not the requirement — `turn-rate` is the item that
 * grades how fast a torpedo comes round.
 */
const TURN_NEEDED = 5 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds 420 units per second through every tick of a turn onto a target", async () => {
  startPlaying(h);
  const target = pointAt(COLUMN, HEADING_DOWN + OFF_AXIS_DEG * DEG, RANGE);
  poseRock(h, "large", target.x, target.y);
  const id = poseTorpedo(h, COLUMN.x, COLUMN.y, HEADING_DOWN);

  const flight = await flyTorpedo(h, id, WATCH_TICKS);
  // The torpedo holding its speed through the turn.
  captureStill(h, "turn");

  const swept = angleGap(
    flight.headings[0],
    flight.headings[flight.headings.length - 1],
  );
  assertGreaterThanOrEqual(
    degrees(swept),
    degrees(TURN_NEEDED),
    "the degrees the torpedo's heading swept while chasing a rock " +
      `${OFF_AXIS_DEG} degrees off it and ${RANGE} units ahead — the control ` +
      "that makes the speeds below a reading of a TURN (specs/weapons.md: with " +
      "a target the torpedo turns its heading toward it, keeping its speed)",
  );

  flight.speeds.forEach((speed, tick) => {
    assertLessThanOrEqual(
      Math.abs(speed - TORPEDO_SPEED),
      TOLERANCE,
      `the units per second the torpedo travelled over tick ${tick + 1} of ` +
        `${flight.ticks} of its turn, against the TORPEDO_SPEED ` +
        `(${TORPEDO_SPEED}) specs/weapons.md holds constant whether or not it ` +
        `is turning; it read ${speed.toFixed(2)}`,
    );
  });
});
