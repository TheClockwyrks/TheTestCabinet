// instrumentation/clear-motes-keeps-the-area-bank — a clear takes the motes and
// leaves the bank.
//
// THE RULE. "`clearMotes()` | Removes every mote, fixtures included, and with
// them every filament and every grip. THE AREA BANK STANDS."
// (`specs/instrumentation.md`, The run). The bank is what `sim.area` counts:
// "`sim.area` | the length of the area bank" (`specs/instrumentation.md`,
// Snapshot shape), and "The area bank is a set of hexes accumulated across the
// run... After every boundary, the settle included, it takes the hex of every
// mote and of every gripper" (`specs/simulation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm and an empty field.
// Two motes are spawned on hexes no part of the machine stands on and one cycle
// is run, so the boundary banks their two hexes and the figure the clear has to
// leave alone is a figure the run really accumulated: the check reads that it
// GREW before it reads that it stood. Nothing on the field moves — the arm's
// tape is blank, "a rest on every part... and never faults" — so no fault can
// end the run under the reading.
//
// THE VERDICT. `sim.area` reports the same figure after the call as before it,
// while `sim.motes` is empty: the hexes banked before the call stay banked. Only
// a fraction of a cycle is run for the picture afterwards, so no further
// boundary can add to the bank between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the same sim.area across a clearMotes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });
  const opened = await h.snapshot();

  await spawnMote(h, at(3, 0), "dust");
  await spawnMote(h, at(0, 3), "dust");
  await advanceCycles(h, 1);
  const banked = await h.snapshot();

  await h.debug.clearMotes();
  const cleared = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "banked");

  assertNotNull(opened.sim, "the run is live from the start");
  assertNotNull(banked.sim, "the run is still live at the boundary");
  assertGreaterThan(
    banked.sim?.area ?? 0,
    opened.sim?.area ?? 0,
    "the boundary banked the two spawned motes' hexes, so the figure the clear must leave alone is one the run accumulated",
  );
  assertNotNull(cleared.sim, "the run is still live after the clear");
  assertLength(
    cleared.sim?.motes ?? [],
    0,
    "the clear really emptied the field, so the bank is being read across a clear that did something",
  );
  assertEqual(
    cleared.sim?.area,
    banked.sim?.area,
    "the area bank stands across a clearMotes: the hexes banked before the call stay banked",
  );
});
