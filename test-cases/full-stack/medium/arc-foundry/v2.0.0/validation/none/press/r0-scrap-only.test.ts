// press/r0-scrap-only — at refinement `R0` the press rolls Scrap and nothing
// else.
//
// It is the opening rung of the track `specs/scrap-press.md` lays out, and the
// reason the track is worth buying: a run starts at `R0`, where the quality
// distribution is `[1, 0, 0, 0, 0]`, so the player's first components are all
// Scrap and every better tier has to be folded for or refined toward. A build
// that leaks a Tuned roll into `R0` hands the player a tier the economy says they
// have not paid for, and one that reads the wrong row of the table does it by
// more.
//
// BOTH THE ODDS AND THE ROLLS. The panel's figure and the press's behaviour have
// to agree, so the reported distribution is read AND a long run of rocks is
// rolled, each dismantled so the next lands on the same footprint.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { REFINEMENT_ODDS, STAMPS_PER_LEVEL, TIERS } from "../constants";
import {
  captureStill,
  createHarness,
  lastStructure,
  openYard,
  refillStamps,
  type Harness,
} from "../harness";

/** How many rocks are rolled. */
const ROLLS = 120;

/** The footprint every rock is dropped on. */
const AT = { col: 20, row: 8 };

/** The scrap tier: the first rung of the quality ladder. */
const SCRAP = TIERS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the R0 odds and rolls Scrap every time", async () => {
  await openYard(h, { refinement: 0 });

  const opened = await h.snapshot();
  assertEqual(opened.refinement, 0, "the refinement level a run opens at");
  assertDeepEqual(
    opened.qualityOdds,
    REFINEMENT_ODDS[0],
    "the quality-roll odds at R0, as the build panel shows them",
  );

  for (let roll = 0; roll < ROLLS; roll += 1) {
    if (roll % STAMPS_PER_LEVEL === 0) await refillStamps(h);
    await h.debug.placeRock(AT.col, AT.row);
    const candidate = lastStructure(await h.snapshot());
    assertEqual(
      candidate.quality,
      SCRAP,
      `the quality of roll ${roll + 1} of ${ROLLS} at refinement 0, where the ` +
        `press rolls Scrap alone`,
    );
    await h.debug.dismantle(candidate.id);
  }

  await h.debug.placeRock(AT.col, AT.row);
  await h.advance(1);
  await captureStill(h, "scrap");
});
