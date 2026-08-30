// press/reroll-blocker — dropping a rock onto a blocker rerolls it in place.
//
// It is the one placement `specs/yard.md` lets land on tiles that are not Open,
// and `specs/scrap-press.md` says what it does: it spends a stamp, removes the
// blocker, and lands a fresh candidate on those four tiles. That is the player's
// only way to get anything back out of the blockers a harvest leaves behind, so a
// build that refuses the drop turns every hardened candidate into permanent dead
// ground.
//
// THE FOOTPRINT COUNT IS THE TELL. A reroll REPLACES rather than adds, so the
// yard carries the same number of structures either side of it — which is what
// separates a real reroll from a build that quietly stacks a candidate on top of
// a blocker it never removed.

import { afterEach, beforeEach, it } from "vitest";

import { STAMPS_PER_LEVEL } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  structureAt,
  type Harness,
} from "../harness";

/** The blocker's footprint, and what the rock that lands on it is armed to roll. */
const AT = { col: 20, row: 8 };
const ROLLS = { type: "discharge", quality: 4 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("replaces the blocker with a fresh candidate for one stamp", async () => {
  openYard(h);
  const blocker = standBlocker(h, AT.col, AT.row);
  const before = h.snapshot();
  assertEqual(
    structureAt(before, AT.col, AT.row)?.kind,
    "blocker",
    `what stands on (${AT.col}, ${AT.row}) before the drop`,
  );

  h.debug.setNextRoll(ROLLS.type, ROLLS.quality);
  h.debug.placeRock(AT.col, AT.row);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "reroll");

  assertLength(
    after.structures,
    before.structures.length,
    "the structures on the yard across a reroll, which replaces rather than adds",
  );
  assertEqual(
    after.structures.some((structure) => structure.id === blocker),
    false,
    `the blocker that stood on (${AT.col}, ${AT.row}) to have been removed`,
  );

  const rolled = structureAt(after, AT.col, AT.row);
  assertEqual(
    rolled?.kind,
    "candidate",
    `what stands on (${AT.col}, ${AT.row}) after the drop`,
  );
  assertEqual(rolled?.type, ROLLS.type, "the type the fresh candidate rolled");
  assertEqual(
    rolled?.quality,
    ROLLS.quality,
    "the quality the fresh candidate rolled",
  );
  assertEqual(
    after.stampsLeft,
    STAMPS_PER_LEVEL - 1,
    "the stamps left after a reroll, which spends one",
  );
});
