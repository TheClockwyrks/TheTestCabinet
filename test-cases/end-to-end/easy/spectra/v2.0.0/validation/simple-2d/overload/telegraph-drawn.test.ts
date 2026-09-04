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
// charge, and says in the same breath that "where on the drone the telegraph sits and
// how it is drawn are yours". So the reading is taken over the drone's whole footprint
// and asks only that enough of it moved: a build that rings the drone, one that tints
// its core and one that crowns it all pass, and only a build whose charge is invisible
// — or whose 1 and 2 look the same — fails.
//
// THE THREE STATES ARE READ AT ONE PLACE, ONE FRAME APART, and that is the whole
// design of this check. A drone's footprint holds whatever the build drew BEHIND it
// too — specs/field.md puts a starfield of at least `STARFIELD_MIN` (40) marks across
// the play field — so three drones read at three different places would be compared
// across three different backgrounds, and the reading would be of the field rather
// than of the telegraph. One drone, posed at one place, with its charge moved between
// consecutive frames, holds everything but the charge still.
//
// THE EVIDENCE IS THE THREE TOGETHER. The picture kept for the reviewer poses three
// drones side by side at charges 0, 1 and 2, which is what "told apart at a glance"
// looks like; it is captured after every reading is taken and cannot reach a verdict.
//
// THE DRONE IS A PROP with every faculty off, so it holds its exact centre and its
// band across all three frames and the only thing that changes between two readings is
// the charge.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, OVERLOAD_AT, SHARD_SIZE } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  readRegion,
  requireOp,
  startPosed,
  type Harness,
} from "../harness";
import { differingPixels, footprint, pixelsIn } from "./charge";

/** Where the drone every reading is taken on stands: mid-field, clear of the HUD. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far apart two readings of the same pixel must sit to count as changed, on the
 * 0-to-441 scale an RGB distance runs on.
 *
 * The figure this case's manifest states for the point: 25 of 441. Above the couple of
 * units an anti-aliased edge moves by, and far below what a mark drawn over a drone
 * reaches.
 */
const MIN_DISTANCE = 25;

/**
 * How much of the footprint must have changed, as a share of the pixels read.
 *
 * specs/mode.md asks for a telegraph told apart "at a glance", which a single moved
 * pixel is not. Three per cent of the drone's own footprint is the floor: a mark that
 * small is still smaller than the drone's smallest feature, so no build that draws a
 * legible telegraph falls under it, and a build that draws none reads zero.
 */
const MIN_FRACTION = 0.03;

/**
 * Where the three drones of the kept picture stand, in charge order.
 *
 * Spread across the formation grid's own span (`x` in [384, 896], specs/field.md), so
 * no two footprints overlap and the reviewer sees three separate drones.
 */
const SHOWN = [
  { x: 400, charge: 0 },
  { x: FORM_CENTER_X, charge: 1 },
  { x: 880, charge: OVERLOAD_AT - 1 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the drone's own pixels with each charge added", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT.x, AT.y, { band: "cyan" });
  const setCharge = requireOp(h, "setDroneCharge");
  const region = footprint(AT.x, AT.y, SHARD_SIZE);

  // Charge 0, then 1, then 2, one frame apart at one place, so the background behind
  // the drone and the drone itself are the same in all three readings.
  await h.advance(1);
  const atZero = readRegion(h, region);
  setCharge(id, 1);
  await h.advance(1);
  const atOne = readRegion(h, region);
  setCharge(id, OVERLOAD_AT - 1);
  await h.advance(1);
  const atTwo = readRegion(h, region);

  // The evidence, posed after every reading is taken: the three states side by side,
  // which is the comparison the specification puts to the eye.
  h.debug.clearDrones();
  for (const shown of SHOWN) {
    poseDrone(h, "shard", shown.x, AT.y, {
      band: "cyan",
      charge: shown.charge,
    });
  }
  await h.advance(1);
  captureStill(h, "charges");

  const floor = Math.ceil(pixelsIn(atZero) * MIN_FRACTION);
  assertGreaterThanOrEqual(
    differingPixels(atZero, atOne, MIN_DISTANCE),
    floor,
    `pixels of the drone's ${String(SHARD_SIZE)}-unit footprint that a first ` +
      `charge moved by more than ${String(MIN_DISTANCE)} of 441, out of ` +
      `${String(pixelsIn(atZero))}: a drone at charge 1 draws a telegraph a drone ` +
      "at charge 0 does not (specs/mode.md)",
  );
  assertGreaterThanOrEqual(
    differingPixels(atOne, atTwo, MIN_DISTANCE),
    floor,
    "pixels of the same footprint that a second charge moved by more than " +
      `${String(MIN_DISTANCE)} of 441, out of ${String(pixelsIn(atOne))}: the ` +
      "telegraph changes visibly with each charge added, so 1 and 2 are told " +
      "apart at a glance (specs/mode.md)",
  );
});
