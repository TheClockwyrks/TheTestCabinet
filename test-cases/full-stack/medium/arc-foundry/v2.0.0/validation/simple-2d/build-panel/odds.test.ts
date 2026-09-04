// build-panel/odds — the panel draws the roll odds the press is actually on.
//
// `specs/hud.md` puts "the quality-roll odds at the live refinement level" at the
// top of the build panel, "so the player reads the probability of each of the
// five tiers before placing a rock", and `specs/scrap-press.md` fixes those odds
// as `REFINEMENT_ODDS[R]`. `specs/instrumentation.md` reports the same five
// numbers as `qualityOdds`.
//
// A build is free to draw a probability as a percentage or as a fraction, so a
// figure counts as drawn when it reads as either. Only the tiers the press can
// actually roll are required: a tier at `0.00` is not a probability the player
// has to read, and how a build shows an impossible tier is its own business.
//
// The change is decided on `0.60`, which `R2` rolls Scrap at and `R5` does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { REFINEMENT_ODDS } from "../../src/constants";
import { PANEL, figures } from "./reading";

const COARSE = 2;
const REFINED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A probability reads as drawn as a percentage or as a fraction. */
function drawsOdd(drawn: readonly number[], odd: number): boolean {
  return drawn.some(
    (f) => Math.abs(f - odd * 100) <= 0.5 || Math.abs(f - odd) <= 0.005,
  );
}

it("draws the live quality odds, and redraws them when the press is refined", async () => {
  openYard(h, { refinement: COARSE });

  const coarse = figures(await h.frameCalls(), PANEL);
  for (const odd of REFINEMENT_ODDS[COARSE]!.filter((o) => o > 0)) {
    assertEqual(
      drawsOdd(coarse, odd),
      true,
      `whether the panel draws the R${COARSE} odds ${odd}; it drew ${coarse.join(", ")}`,
    );
  }

  h.debug.setRefinement(REFINED);
  const refined = figures(await h.frameCalls(), PANEL);
  captureStill(h, "odds");
  for (const odd of REFINEMENT_ODDS[REFINED]!.filter((o) => o > 0)) {
    assertEqual(
      drawsOdd(refined, odd),
      true,
      `whether the panel draws the R${REFINED} odds ${odd}; it drew ${refined.join(", ")}`,
    );
  }
  assertEqual(
    drawsOdd(refined, REFINEMENT_ODDS[COARSE]![0]!),
    false,
    `whether the panel still draws the R${COARSE} Scrap odds once the press is ` +
      `at R${REFINED}; it drew ${refined.join(", ")}`,
  );
});
