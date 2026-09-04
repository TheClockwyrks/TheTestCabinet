// Meltdown — waves/speed-does-not-change-the-outcome: the same game time
// delivered at either speed leaves the floor in the same place.
//
// `specs/waves.md`, Pause and speed: "The speed changes how fast a run plays and
// not what it reaches: the same game time delivered at either setting leaves the
// floor in the same state." The same file's opening paragraph is the reason it
// can: "Every rate in this specification is per second and is integrated against
// that game time, so an interval of game time reaches the same state however it
// was divided into frames."
//
// THE TWO LEGS DELIVER THE SAME GAME TIME OUT OF DIFFERENT ELAPSED TIME. The leg
// at speed `1` spends `180` frames of the suite's `120` Hz clock, a second and a
// half of elapsed time; the leg at speed `2` spends `90` of them, three quarters
// of a second of elapsed time, and doubles it. Both should hand the simulation
// `1.5` seconds of game time, and the walker should therefore stand in the same
// place at the end of each.
//
// THE EQUAL GAME TIME IS A PRECONDITION, and it is asserted as one. A build that
// ignores the toggle delivers half as much in the second leg, and its Mote
// stands half as far along: that build is broken at
// `waves.speed-doubles-the-game-time`, which is the item that names the defect,
// and the precondition here says so in the failure rather than letting this item
// claim a second verdict on the same fault. What is left for the point itself is
// the defect only this item can see: a build whose per-frame integration is not
// linear in the delta — a speed that skips frames, a step clamped to a fixed
// size, a rate applied per FRAME rather than per second — which reaches a
// different place from the same game time.
//
// EACH LEG IS ITS OWN RUN. Both open from `startRun`, which resets first, and
// pose their own Mote on the same tile of the same straight open row
// (`waves/run.ts`), so the two legs differ in the speed and the frame count and
// in nothing else.
//
// THE POSITION IS THE WHOLE FLOOR'S STAND-IN. The Mote's centre is the one thing
// on this floor that a difference in integration moves, because nothing else is
// on it: no tower to heat, no wave to release, no timer that matters.
//
// WHAT EVERY WRONG MODEL READS. A build that advances a fixed step per frame
// walks half as far in the leg of half the frames; one that applies its speeds
// per frame rather than per second does the same; one that rounds its delta to
// whole frames of some internal tick lands a tick apart, which is more than the
// tolerance below.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThan, fail } from "../assert";
import {
  captureStill,
  clockGain,
  createHarness,
  distance,
  positionOf,
  startRun,
  ticksFor,
  unitById,
  windowOfFrames,
  type Harness,
  type Point,
} from "../harness";
import { poseMote } from "./run";

/** The game time each leg delivers, in seconds. */
const GAME_TIME = 1.5;

/**
 * The frames each leg spends: the same game time out of twice and half the
 * elapsed.
 */
const SINGLE_TICKS = ticksFor(GAME_TIME);
const DOUBLE_TICKS = SINGLE_TICKS / 2;

/**
 * How far apart the two legs' game times may be, as decimal places of a second.
 *
 * Two places is `0.005` of a second, under one frame of the suite's `120` Hz
 * clock. It is a precondition on the arrangement rather than a bound on the
 * build: the two legs deliver the same game time exactly, or the comparison
 * below is between two different stretches of the game.
 */
const CLOCK_DIGITS = 2;

/**
 * How far apart the two legs may leave the Mote: `2` logical units.
 *
 * A tenth of one `TILE` (`19`), against the `90` units the Mote walks in either
 * leg. The allowance is two frames of the faster leg — a frame at speed `2`
 * carries the Mote one logical unit — which covers a build that resolves a posed
 * field on the frame after the pose, at either speed. Every defect this point is
 * looking for is a whole fraction of the distance out, not two units.
 */
const MAX_GAP = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Deliver `GAME_TIME` at `speed` on a fresh run, and report where the Mote
 * stands and how much game time the leg spent.
 */
async function legAt(
  speed: number,
  ticks: number,
): Promise<{ at: Point; clock: number }> {
  startRun(h);
  const mote = poseMote(h);
  h.debug.setSpeed(speed);

  const window = await windowOfFrames(h, ticks);
  const unit = unitById(window.closed, mote);
  if (unit === undefined) {
    fail(
      `the Mote on the floor when the leg at speed ${speed} closed`,
      "it was gone",
    );
  }
  return { at: positionOf(unit), clock: clockGain(window) };
}

it("leaves the walker in the same place at either speed", async () => {
  const single = await legAt(1, SINGLE_TICKS);
  const double = await legAt(2, DOUBLE_TICKS);

  captureStill(h, "outcome");

  assertCloseTo(
    double.clock,
    single.clock,
    CLOCK_DIGITS,
    "precondition: the game time the leg at speed 2 delivered, against the " +
      "leg at speed 1",
  );
  assertLessThan(
    distance(double.at, single.at),
    MAX_GAP,
    `the logical units between where ${GAME_TIME} s of game time left the ` +
      `Mote at speed 2 and where it left it at speed 1`,
  );
});
