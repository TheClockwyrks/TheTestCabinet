// instrumentation/link-motes — `linkMotes` joins two motes with one filament.
//
// THE RULE. "`linkMotes(a, b, weight)` | Joins motes `a` and `b` with one
// filament of `weight` `1` or `3`" (`specs/instrumentation.md`, The run), and the
// snapshot reports "`filaments: [{ a: <mote id>, b: <mote id>, weight: 1 | 3 }]`".
// What a filament is: "A filament is a rigid link between two motes on adjacent
// hexes. It carries a `weight` of `1` or `3`; a weight of `3` is a triune
// filament" (`specs/field.md`), and a filament makes a constellation: "A
// constellation is a maximal group of motes connected by filaments."
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty machine and an empty
// field, and three motes spawned back on `(0, 0)` and its neighbors `(1, 0)` and
// `(0, -1)`. Nothing else is on the field: no sigil that could bind or sunder,
// and no part that could carry, so every filament the run reports is one this
// check made. Both weights the rule allows are made, one each, so neither is read
// off the other.
//
// THE VERDICT. `sim.filaments` holds exactly two entries: one of weight `1`
// joining the first pair and one of weight `3` joining the second, each found by
// the pair it joins rather than by the order its ends were named — the rule fixes
// the pair and the weight, and nothing fixes which end is `a`. The three motes
// are one constellation, which is what a filament between them means.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  constellationOf,
  createHarness,
  filamentBetween,
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

it("adds one filament of the named weight between two motes", async () => {
  await openBareRun(h, { challenge: BARE });
  const middle = await spawnMote(h, at(0, 0), "nova");
  const east = await spawnMote(h, at(1, 0), "nova");
  const north = await spawnMote(h, at(0, -1), "nova");

  await h.debug.linkMotes(middle, east, 1);
  await h.debug.linkMotes(middle, north, 3);
  const posed = await h.snapshot();

  await captureReplay(h, "linked", () => advanceCycles(h, 1));

  assertNotNull(posed.sim, "the run is live at the two calls");
  assertLength(
    posed.sim?.filaments ?? [],
    2,
    "two calls add two filaments, and the field carried none before them",
  );
  assertEqual(
    filamentBetween(posed, middle, east)?.weight,
    1,
    "the first call joined its pair with a filament of the weight it named",
  );
  assertEqual(
    filamentBetween(posed, middle, north)?.weight,
    3,
    "the second call joined its pair with a triune filament, the other weight the rule allows",
  );
  assertDeepEqual(
    constellationOf(posed, east),
    [middle, east, north].sort((a, b) => a - b),
    "the filaments join the three motes into one constellation",
  );
});
