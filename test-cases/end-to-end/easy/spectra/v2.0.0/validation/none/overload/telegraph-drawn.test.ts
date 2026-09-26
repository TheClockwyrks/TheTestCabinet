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
import { assertGreaterThan } from "../assert";
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
import { PAINT_MIN, differingSamples } from "./charge";

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

it("paints the drone's own footprint when it takes a charge", async () => {
  await startPosed(harness);
  const id = await poseDrone(harness, "shard", AT.x, AT.y, { band: "cyan" });
  const region = footprint(AT.x, AT.y, SHARD_SIZE);

  // What the footprint does on its own across one frame, with the charge left at
  // 0: whatever the build animates, behind the drone and on it.
  await harness.advance(1);
  const atZeroFirst = await readRegion(harness, region, STEP);
  await harness.advance(1);
  const atZero = await readRegion(harness, region, STEP);
  const drift = differingSamples(atZeroFirst, atZero, PAINT_MIN);

  // The first charge, one frame later at the same place, so the background behind
  // the drone and the drone itself are the same in both readings.
  await harness.debug.setDroneCharge(id, 1);
  await harness.advance(1);
  const atOne = await readRegion(harness, region, STEP);

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

  assertGreaterThan(
    differingSamples(atZero, atOne, PAINT_MIN),
    drift,
    `samples of the drone's ${String(SHARD_SIZE)}-unit footprint that a first ` +
      `charge repainted, out of ${String(atZero.length)}: a drone at charge 1 ` +
      "draws a telegraph within its own footprint that a drone at charge 0 does " +
      `not (specs/mode.md); the footprint moved on its own across one frame in ` +
      `${String(drift)} samples`,
  );
});
