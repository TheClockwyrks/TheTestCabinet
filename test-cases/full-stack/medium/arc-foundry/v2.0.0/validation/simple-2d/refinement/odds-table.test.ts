// refinement/odds-table — the live odds are the refinement level's own row.
//
// specs/scrap-press.md fixes the whole table: "`REFINEMENT_ODDS` holds one
// five-tier distribution per level, each summing to `1`", nine rows for `R0`
// through `R8`, with `R0` rolling Scrap alone and `R8` the only row that ever
// rolls Tesla-Prime. specs/instrumentation.md fixes where a caller reads them:
// `qualityOdds` is "the live roll odds, summing to 1" and "the five-tier
// distribution at the current refinement level, the same odds the build panel
// shows", and `setRefinement` sets "the refinement level ... and with it the roll
// odds".
//
// Each of the nine levels is set in turn and its row is read straight back. The
// yard is empty throughout, because nothing on it bears on the odds: this is the
// press's own distribution and it is read from the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { REFINEMENT_MAX, REFINEMENT_ODDS } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** A refinement level worth a picture: the odds a refined press draws from. */
const PICTURED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports REFINEMENT_ODDS[R] at every one of the nine levels", async () => {
  openYard(h);

  for (let level = 0; level <= REFINEMENT_MAX; level += 1) {
    h.debug.setRefinement(level);
    if (level === PICTURED) {
      await h.advance(1);
      captureStill(h, "odds");
    }

    const s = h.snapshot();
    assertEqual(s.refinement, level, "the level the press was set to");
    assertLength(
      s.qualityOdds,
      5,
      `one weight per quality tier at R${level} (specs/scrap-press.md)`,
    );

    const row = REFINEMENT_ODDS[level]!;
    for (const [tier, weight] of row.entries()) {
      assertCloseTo(
        s.qualityOdds[tier]!,
        weight,
        6,
        `the weight on tier ${tier + 1} at R${level} (specs/scrap-press.md)`,
      );
    }
    assertCloseTo(
      s.qualityOdds.reduce((sum, weight) => sum + weight, 0),
      1,
      6,
      `the row at R${level} summing to 1 (specs/scrap-press.md)`,
    );
  }
});
