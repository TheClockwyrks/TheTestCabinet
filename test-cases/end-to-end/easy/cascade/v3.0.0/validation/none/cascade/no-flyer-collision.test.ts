// cascade/no-flyer-collision — cards in flight pass through one another.
//
// specs/victory.md: "A card in flight collides with nothing: not the side edges,
// not the piles beneath it, and not another card in flight, so two cards crossing
// the same point keep their velocities through the crossing."
//
// TWO CARDS ARE AIMED AT ONE POINT AT THE SAME HEIGHT. Both are released from
// rest vertically at `y = 60`, so they fall together and stay level with each
// other for the whole drive; they close on each other at `800` units per second
// and overlap from `0.25` s to `0.5` s, which the drive covers and then leaves,
// so the reading is taken with the pair well past one another. That the overlap
// actually happened is asserted rather than assumed, because a crossing that
// never occurred would make the rest of the reading vacuous.
//
// Both components are read. A build that exchanged or reversed horizontal
// velocities reads `-400` where `+400` is expected; a build that resolved the
// overlap vertically separates the two, so their `vy` no longer agree. The two
// cards are the whole world: the table is empty and nothing is launching, so
// there is no third body for either to have hit instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { CARD_H, CARD_W } from "../constants";
import {
  type Harness,
  captureStill,
  createHarness,
  framesFor,
  poseFlyer,
  requireFlyer,
} from "../harness";
import { frameSamples, openFlight } from "./flight";

/** The two cards, level with each other and closing head-on. */
const LEFTWARD = { x: 750, y: 60, vx: -400, vy: 0 };
const RIGHTWARD = { x: 450, y: 60, vx: 400, vy: 0 };

/**
 * How far the drive runs, in frames.
 *
 * The pair overlaps between `0.25` s and `0.5` s and is `180` units apart at
 * `0.6` s, by which point they have fallen `324` units — still `196` above
 * `FLOOR_Y`, so no bounce enters the reading.
 */
const DRIVE_FRAMES = framesFor(0.6);

/**
 * How far a velocity may move across the crossing, in units per second.
 *
 * No step of a frame writes `vx`, and the only step that writes `vy` is gravity,
 * which acts on both cards identically. So the only slack either reading needs
 * is the rounding of a double through JSON.
 */
const VELOCITY_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("lets two flyers cross the same point with their velocities intact", async () => {
  await openFlight(harness);
  const left = await poseFlyer(harness, LEFTWARD);
  const right = await poseFlyer(harness, RIGHTWARD);

  const samples = await frameSamples(harness, DRIVE_FRAMES);
  await captureStill(harness, "crossing");

  const overlapped = samples.some((s) => {
    const a = s.flyers.find((f) => f.id === left);
    const b = s.flyers.find((f) => f.id === right);
    if (a === undefined || b === undefined) return false;
    return Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H;
  });
  assertTrue(
    overlapped,
    "the two cards to overlap at some frame of the drive, so there is a crossing to read",
  );

  const end = samples[samples.length - 1];
  const a = requireFlyer(end, left, "after crossing the other card");
  const b = requireFlyer(end, right, "after crossing the other card");

  assertLessThanOrEqual(
    Math.abs(a.vx - LEFTWARD.vx),
    VELOCITY_TOLERANCE,
    `the vx of the leftward card after the crossing, which was ${LEFTWARD.vx} going in`,
  );
  assertLessThanOrEqual(
    Math.abs(b.vx - RIGHTWARD.vx),
    VELOCITY_TOLERANCE,
    `the vx of the rightward card after the crossing, which was ${RIGHTWARD.vx} going in`,
  );
  assertLessThanOrEqual(
    Math.abs(a.vy - b.vy),
    VELOCITY_TOLERANCE,
    `the two cards to share a vy after the crossing, as they did before it, and they read ${a.vy} and ${b.vy}`,
  );
});
