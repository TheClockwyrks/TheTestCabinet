// abilities/coil-chain-ends — a chain with nowhere to go simply ends.
//
// specs/components.md fixes the edge case the chain rule implies: "A leap that
// finds no unit in range it has not already struck ends the chain." It is its own
// point because it is the case a build reaches on almost every early wave — one
// unit walking alone past a Coil — and the case a chain written as a loop over
// neighbours most easily throws on.
//
// The yard holds one Coil and one held unit and nothing else, so the first leap
// has nothing to find. Two things are read: the lone unit lost exactly the primary
// hit and not a leap's worth more, and the page logged nothing. A build that
// throws while resolving the chain fails here even if the health happens to come
// out right, because a thrown update is a game that has stopped.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertLength } from "../assert";
import { componentDamage } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { awaitImpact } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Coil's `110`. */
const TARGET_RANGE = 60;

/** The tier the lone hit is read at. */
const TIER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the primary hit off a lone unit and throws nothing", async () => {
  await openYard(h, { wave: 5 });
  const id = await standComponent(h, "coil", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(await h.snapshot(), id);
  const lone = await parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const before = await h.snapshot();
  assertLength(
    before.units,
    1,
    "units on the yard: the chain has nowhere to go",
  );

  const after = await captureReplay(h, "lone", () => awaitImpact(h, lone));

  assertCloseTo(
    unitById(before, lone).hp - unitById(after, lone).hp,
    componentDamage("coil", TIER),
    6,
    "the health the lone unit lost: the primary hit, with no leap to add to it",
  );
  assertDeepEqual(
    h.pageErrors,
    [],
    "what the page logged or threw while the chain resolved with nothing to " +
      "leap to",
  );
});
