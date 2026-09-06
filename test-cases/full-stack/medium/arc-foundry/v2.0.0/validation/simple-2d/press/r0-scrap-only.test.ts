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
// to agree, so the reported distribution is read AND a bounded sample of rolls is
// drawn through `rollPress`, the operation `specs/instrumentation.md` carries for
// performing the one draw alone.

import { afterEach, beforeEach, it } from "vitest";
import { REFINEMENT_ODDS, TIERS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness, openYard } from "../harness";

/** How many rolls are drawn. */
const ROLLS = 120;

/** The scrap tier: the first rung of the quality ladder. */
const SCRAP = TIERS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the R0 odds and rolls Scrap every time", async () => {
  openYard(h, { refinement: 0 });

  const opened = h.snapshot();
  assertEqual(opened.refinement, 0, "the refinement level a run opens at");
  assertDeepEqual(
    opened.qualityOdds,
    REFINEMENT_ODDS[0],
    "the quality-roll odds at R0, as the build panel shows them",
  );

  for (let roll = 0; roll < ROLLS; roll += 1) {
    const { quality } = h.debug.rollPress();
    assertEqual(
      quality,
      SCRAP,
      `the quality of roll ${roll + 1} of ${ROLLS} at refinement 0, where the ` +
        `press rolls Scrap alone`,
    );
  }

  await h.advance(1);
  captureStill(h, "scrap");
});
