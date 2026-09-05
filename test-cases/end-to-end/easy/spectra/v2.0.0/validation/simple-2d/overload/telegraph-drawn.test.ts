// overload/telegraph-drawn — the charge is shown on the drone that carries it.
//
// specs/mode.md: "A drone's charge is legible on the drone itself. Every drone that
// carries at least one charge draws a telegraph within its own footprint that reads
// how far along it is: the telegraph changes visibly with each charge added, so a
// drone at charge `1` and a drone at charge `2` are told apart at a glance, and a
// drone at charge `0` draws none at all."
//
// WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. What a script can decide of that
// rule is that a charge IS DRAWN: a drone at charge 1 repaints its own footprint
// where the same drone at charge 0 leaves it alone. How far along the telegraph
// reads, how much of the drone it covers and what it is drawn in are the reviewer's
// presentation rating, because specs/mode.md says in the same breath that "where on
// the drone the telegraph sits and how it is drawn are yours". So a build that rings
// the drone, one that tints its core and one that crowns it all pass, and only a
// build whose charge is invisible fails.
//
// THE TWO STATES ARE READ AT ONE PLACE, ONE FRAME APART, and that is the whole
// design of this check. A drone's footprint holds whatever the build drew BEHIND it
// too — specs/field.md puts a starfield of at least `STARFIELD_MIN` (40) marks
// across the play field — so two drones read at two different places would be
// compared across two different backgrounds, and the reading would be of the field
// rather than of the telegraph. One drone, posed at one place, with its charge moved
// between consecutive frames, holds everything but the charge still.
//
// THE CONTROL. A build is free to animate what it draws, so the footprint's own
// frame-to-frame drift is read first, with the charge left at 0 across both frames,
// and the change the first charge causes has to beat it.
//
// THE EVIDENCE IS THE THREE TOGETHER. The picture kept for the reviewer poses three
// drones side by side at charges 0, 1 and 2, which is what "told apart at a glance"
// looks like; it is captured after every reading is taken and cannot reach a
// verdict.
//
// THE DRONE IS A PROP with every faculty off, so it holds its exact centre and its
// band across every frame and the only thing that changes between two readings is
// the charge.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, OVERLOAD_AT, SHARD_SIZE } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  readRegion,
  requireOp,
  startPosed,
  type Harness,
} from "../harness";
import { PAINT_MIN, differingPixels, footprint, pixelsIn } from "./charge";

/** Where the drone every reading is taken on stands: mid-field, clear of the HUD. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

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

it("paints the drone's own footprint when it takes a charge", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT.x, AT.y, { band: "cyan" });
  const setCharge = requireOp(h, "setDroneCharge");
  const region = footprint(AT.x, AT.y, SHARD_SIZE);

  // What the footprint does on its own across one frame, with the charge left at 0:
  // whatever the build animates, behind the drone and on it.
  await h.advance(1);
  const atZeroFirst = readRegion(h, region);
  await h.advance(1);
  const atZero = readRegion(h, region);
  const drift = differingPixels(atZeroFirst, atZero, PAINT_MIN);

  // The first charge, one frame later at the same place, so the background behind
  // the drone and the drone itself are the same in both readings.
  setCharge(id, 1);
  await h.advance(1);
  const atOne = readRegion(h, region);

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

  assertGreaterThan(
    differingPixels(atZero, atOne, PAINT_MIN),
    drift,
    `pixels of the drone's ${String(SHARD_SIZE)}-unit footprint that a first ` +
      `charge repainted, out of ${String(pixelsIn(atZero))}: a drone at charge 1 ` +
      "draws a telegraph within its own footprint that a drone at charge 0 does " +
      "not (specs/mode.md); the footprint moved on its own across one frame in " +
      `${String(drift)} pixels`,
  );
});
