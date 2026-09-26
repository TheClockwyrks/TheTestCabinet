// Meltdown — combat/fire-clock-holds-without-a-target: the fire clock waits.
//
// `specs/combat.md`: "On a frame in which it has no target, or is tripped, the
// accumulator neither grows nor falls", and therefore "an emitter that has sat
// without a target lands its first shot one full interval after the target
// arrives". So the ten seconds this emitter spends alone must leave its clock
// exactly where it started, and the shot must come half a second after the mark
// appears rather than on the frame it does.
//
// WHAT THE WRONG MODEL LOOKS LIKE, AND WHY THIS POINT EXISTS. A build that adds
// the frame's time to the accumulator unconditionally — the obvious way to write
// it — banks twenty intervals over those ten seconds and fires the instant a mark
// comes into range, and then goes on firing at its real rate, so every other
// point in this group passes. The only reading that separates the two is the one
// below: whether anything is removed inside the first interval after the mark
// arrives.
//
// THE TEN SECONDS ARE SPENT WITH `coast`, which runs the same real update off
// camera. Nothing is measured across them, so no frame boundary needs to be
// opened, and the point costs a replay nothing.
//
// THE MARK APPEARS WITH THE CLOCK ALREADY OLD. `poseMarkEast` puts it three tiles
// out, well inside the Arc's `6.0`, and takes its motion off, so the acquisition
// happens on the first frame after it is posed and the interval being timed
// starts there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  type Harness,
} from "../harness";
import { NEAR_UNITS, fireRateOf, poseGun, poseMarkEast, readHp } from "./duel";

/** The emitter read, and the heat it is pinned at. */
const TOWER = "arc";
const HEAT = 0;

/** `specs/towers.md`: 2.0 shots a second, so a half-second interval. */
const FIRE_RATE = fireRateOf(TOWER);

/** How long the emitter sits with nothing to shoot at, in seconds. */
const IDLE_SECONDS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The fire clock waits for a target", async () => {
  await poseGun(h, TOWER, HEAT);
  await h.coast(IDLE_SECONDS);

  const mark = await poseMarkEast(h, TOWER, "mote", NEAR_UNITS);
  const opened = await readHp(h, mark);

  // Half an interval in: the furthest point from both boundaries of the first
  // interval, and before the first shot of a run may resolve.
  const earlyFrames = framesForShots(0, FIRE_RATE);
  await h.advance(earlyFrames);
  const early = opened - (await readHp(h, mark));

  await h.advance(framesForShots(1, FIRE_RATE) - earlyFrames);
  await captureStill(h, "waiting");
  const late = opened - (await readHp(h, mark));

  assertEqual(
    early,
    0,
    `hp removed in the first ${0.5 / FIRE_RATE}s after a target arrived, ` +
      `on an emitter that had sat ${IDLE_SECONDS}s without one`,
  );
  assertGreaterThan(
    late,
    0,
    `hp removed by the first shot, one ${1 / FIRE_RATE}s interval after the ` +
      `target arrived`,
  );
});
