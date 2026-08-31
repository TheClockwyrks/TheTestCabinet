// overload/telegraph-drawn — the charge is legible on the drone that carries it.
//
// specs/mode.md: "A drone's charge is legible on the drone itself. Every drone that
// carries at least one charge draws a telegraph within its own footprint that reads
// how far along it is: the telegraph changes visibly with each charge added, so a
// drone at charge `1` and a drone at charge `2` are told apart at a glance, and a
// drone at charge `0` draws none at all."
//
// WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. The specification fixes that the
// telegraph is drawn WITHIN THE DRONE'S OWN FOOTPRINT and that it CHANGES with each
// charge, and says in the same breath that "where on the drone the telegraph sits
// and how it is drawn are yours". So the reading is taken over the drone's whole
// footprint and asks only that enough of it moved: a build that rings the drone, one
// that tints its core and one that crowns it all pass, and only a build whose
// charge is invisible — or whose 1 and 2 look the same — fails.
//
// THE THREE STATES ARE READ AT ONE PLACE, ONE FRAME APART, and that is the whole
// design of this check. A drone's footprint holds whatever the build drew BEHIND it
// too — specs/field.md puts a starfield of at least `STARFIELD_MIN` (40) marks
// across the play field — so three drones read at three different places would be
// compared across three different backgrounds, and the reading would be of the
// field rather than of the telegraph. One drone, posed at one place, with its charge
// moved between consecutive frames, holds everything but the charge still.
//
// THE EVIDENCE IS THE THREE TOGETHER. The picture kept for the reviewer poses three
// drones side by side at charges 0, 1 and 2, which is what "told apart at a glance"
// looks like; it is captured after every reading is taken and cannot reach a
// verdict.
//
// THE DRONE IS A PROP with every faculty off, so it holds its exact centre and its
// band across all three frames and the only thing that changes between two readings
// is the charge.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { FORM_CENTER_X, OVERLOAD_AT, SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  footprint,
  poseDrone,
  readRegion,
  startPosed,
  type Harness,
} from "../harness";
import { differingSamples } from "./charge";

/** Where the drone every reading is taken on stands: mid-field, clear of the HUD. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How finely the footprint is sampled, in logical units.
 *
 * Every other pixel of the `SHARD_SIZE` (28) square the drone is drawn in — 196
 * samples — which resolves a mark a fifth of the drone across while keeping the
 * whole reading to one crossing into the page.
 */
const STEP = 2;

/**
 * How far apart two samples of the same point must sit to count as changed, on the
 * 0-to-441 scale an RGB distance runs on.
 *
 * The figure this case's manifest states for the point: 25 of 441. Above the
 * couple of units an anti-aliased edge moves by, and far below what a mark drawn
 * over a drone reaches.
 */
const MIN_DISTANCE = 25;

/**
 * How much of the footprint must have changed, as a share of the samples taken.
 *
 * specs/mode.md asks for a telegraph told apart "at a glance", which a single moved
 * pixel is not. Three per cent of the drone's own footprint is the floor: a mark
 * that small is still smaller than the drone's smallest feature, so no build that
 * draws a legible telegraph falls under it, and a build that draws none reads zero.
 */
const MIN_FRACTION = 0.03;

/** Where the three drones of the kept picture stand, in charge order. */
const SHOWN = [
  { x: 400, charge: 0 },
  { x: FORM_CENTER_X, charge: 1 },
  { x: 880, charge: OVERLOAD_AT - 1 },
] as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("moves the drone's own pixels with each charge added", async () => {
  await startPosed(harness);
  const id = await poseDrone(harness, "shard", AT.x, AT.y, { band: "cyan" });
  const region = footprint(AT.x, AT.y, SHARD_SIZE);

  // Charge 0, then 1, then 2, one frame apart at one place, so the background
  // behind the drone and the drone itself are the same in all three readings.
  await harness.advance(1);
  const atZero = await readRegion(harness, region, STEP);
  await harness.debug.setDroneCharge(id, 1);
  await harness.advance(1);
  const atOne = await readRegion(harness, region, STEP);
  await harness.debug.setDroneCharge(id, OVERLOAD_AT - 1);
  await harness.advance(1);
  const atTwo = await readRegion(harness, region, STEP);

  // The evidence, posed after every reading is taken: the three states side by
  // side, which is the comparison the specification puts to the eye.
  await harness.debug.clearDrones();
  for (const shown of SHOWN) {
    await poseDrone(harness, "shard", shown.x, AT.y, {
      band: "cyan",
      charge: shown.charge,
    });
  }
  await harness.advance(1);
  await captureStill(harness, "charges");

  const floor = Math.ceil(atZero.length * MIN_FRACTION);
  assertGreaterThanOrEqual(
    differingSamples(atZero, atOne, MIN_DISTANCE),
    floor,
    `samples of the drone's ${String(SHARD_SIZE)}-unit footprint that a first ` +
      `charge moved by more than ${String(MIN_DISTANCE)} of 441, out of ` +
      `${String(atZero.length)}: a drone at charge 1 draws a telegraph a drone at ` +
      "charge 0 does not (specs/mode.md)",
  );
  assertGreaterThanOrEqual(
    differingSamples(atOne, atTwo, MIN_DISTANCE),
    floor,
    `samples of the same footprint that a second charge moved by more than ` +
      `${String(MIN_DISTANCE)} of 441, out of ${String(atOne.length)}: the ` +
      "telegraph changes visibly with each charge added, so 1 and 2 are told " +
      "apart at a glance (specs/mode.md)",
  );
});
