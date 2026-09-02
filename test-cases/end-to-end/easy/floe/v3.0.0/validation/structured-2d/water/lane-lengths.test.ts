// Floe — water/lane-lengths: each floe kind spans the number of tiles its own
// row of the floe table gives it.
//
// specs/water.md: a `pan` is `1` tile, a `raft3` `3` and a `raft4` `4`, and
// `ITEM_LEN` "names the length in tiles of every lane item". The length is not
// decoration: the covering rule is written on it — an item occupies
// `[x, x + TILE * len)` — so every footing, every carry and every gap in this
// group is measured against the span this check decides, and specs/water.md
// states the consequence outright: "A floe is one continuous platform. Every
// tile it covers is footing, so a raft's whole span carries the critter."
//
// It reads every floe on a freshly laid-out level rather than one of each kind,
// so a build that got a raft right in one lane and wrong in another fails with
// the row named. The three kinds are each required to appear, because the table
// puts all three on the eight lanes and a reading that saw only pans would have
// graded a third of the requirement.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { ITEM_LEN, WATER_LANES } from "../constants";
import {
  captureStill,
  createHarness,
  type FloeKind,
  type Harness,
} from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out. The kinds' lengths are the same at every level. */
const LEVEL = 1;

/** The three kinds the water band carries (specs/water.md). */
const FLOE_KINDS: readonly FloeKind[] = ["pan", "raft3", "raft4"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spans a pan over 1 tile, a raft3 over 3 and a raft4 over 4, on every lane", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  assertGreaterThanOrEqual(
    laid.floes.length,
    WATER_LANES.length,
    "the eight water lanes carry floes at all (specs/water.md)",
  );

  for (const floe of laid.floes) {
    assertContains(
      FLOE_KINDS,
      floe.kind,
      `row ${floe.row} at x ${floe.x}: the water band carries only pans, ` +
        `raft3s and raft4s (specs/water.md)`,
    );
    assertEqual(
      floe.len,
      ITEM_LEN[floe.kind],
      `row ${floe.row}, ${floe.kind} at x ${floe.x}: len in tiles`,
    );
  }

  // All three kinds are on the table, so all three are on the strait: a level
  // that laid down only one kind would otherwise have graded only that one.
  const drawn = new Set(laid.floes.map((floe) => floe.kind));
  for (const kind of FLOE_KINDS) {
    assertContains(
      [...drawn],
      kind,
      `the lane table puts a ${kind} on the water band (specs/water.md)`,
    );
  }
});
