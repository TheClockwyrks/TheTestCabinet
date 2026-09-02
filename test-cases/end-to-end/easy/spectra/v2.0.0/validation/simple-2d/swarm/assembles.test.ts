// swarm/assembles — every drone of a wave ends its entrance in its slot.
//
// specs/swarm.md, "The wave and its entrance": a released drone's path "ends with
// the drone at its slot within six seconds of its release, and the drone is then in
// phase `formation`, riding the sway with the rest of the block". The last group of
// a wave is released `ENTER_GROUP_GAP` (0.6 s) times seven after the wave opens at
// the very most — a wave releases its drones in between two and eight groups — so
// twelve seconds after the wave opens covers the last group's release and its whole
// entrance with more than a second to spare. Twelve is the item's own figure.
//
// WHAT "AT ITS SLOT" IS READ AS. The slot the drone reports, plus the sway the
// whole block is riding: a formation drone sits at `(slotX + swayOffset(t),
// slotY)` (`specs/field.md`), and the wave's sway clock is not something this point
// poses, so the horizontal reading allows the whole `SWAY_AMP` (20) the offset can
// reach and one unit besides. Its `y` is the slot's outright, because the sway is
// horizontal. Where in the swing the block actually is, and that it swings at all,
// are `field/sway-amplitude`'s and `field/sway-period`'s.
//
// THE WAVE IS THE GAME'S OWN: assembling is what a wave the build laid out does,
// and no pose can produce it. The dive gate is shut, because a build that has
// assembled correctly launches its first dive two seconds in and would be read as a
// wave that never settled; the contact gate is shut so nothing reaching the ship
// interrupts the wave.

import { afterEach, beforeEach, it } from "vitest";
import { SWAY_AMP } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  type Harness,
} from "../harness";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/** The seconds the whole wave is given to assemble: the item's own figure. */
const ASSEMBLE_BY = 12;

/**
 * How far a settled drone's centre may sit from its slot horizontally, in logical
 * units: the sway's full reach, plus one unit, which is the item's own tolerance on
 * the slot itself.
 */
const X_TOLERANCE = SWAY_AMP + 1;

/** How far it may sit vertically: one unit, since the sway is horizontal. */
const Y_TOLERANCE = 1;

/** The drones a standard wave must have built for this reading to mean anything. */
const MIN_DRONES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("settles every drone of a wave into phase formation at its slot", async () => {
  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);
  await startStage(h, STAGE);

  await h.advanceSeconds(ASSEMBLE_BY);
  const settled = h.snapshot();
  captureStill(h, "assembled");

  assertGreaterThanOrEqual(
    settled.drones.length,
    MIN_DRONES,
    `the drones the wave still held ${String(ASSEMBLE_BY)}s after it opened ` +
      `(specs/swarm.md)`,
  );

  for (const drone of settled.drones) {
    assertEqual(
      drone.phase,
      "formation",
      `the phase drone ${String(drone.id)} (${drone.kind}) reached ` +
        `${String(ASSEMBLE_BY)}s after the wave opened (specs/swarm.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(drone.x - drone.slotX),
      X_TOLERANCE,
      `how far drone ${String(drone.id)} sat from its slot's x ` +
        `(${String(drone.slotX)}) once the wave had assembled, allowing the ` +
        `block's SWAY_AMP (${String(SWAY_AMP)}) offset (specs/swarm.md, ` +
        `specs/field.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(drone.y - drone.slotY),
      Y_TOLERANCE,
      `how far drone ${String(drone.id)} sat from its slot's y ` +
        `(${String(drone.slotY)}) once the wave had assembled (specs/swarm.md)`,
    );
  }
});
