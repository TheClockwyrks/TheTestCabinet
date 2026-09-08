// presentation/hud-score — the HUD carries the run's score in digits.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Score | The run's score in digits,
// updated on the tick it changes", drawn on `playing` among the six readouts the
// HUD carries.
//
// THE FIGURE, AND WHY IT IS 50. `specs/extraction.md`: "An extraction of `n`
// cores at chain step `k` adds `10 x n x k` to the score", "The chain step `k` is
// an integer that is 1 when a level begins", and an "Extraction on an insertion"
// scores at step 1. So an insertion that completes a run of five, on a level just
// opened, pays exactly `10 x 5 x 1 = 50` and nothing else can be showing that
// figure: the score before it was 0, the level in play is 1, and the cells are
// drawn as icons rather than as a number.
//
// Nothing else stands on the channel and nothing arrives. The extraction may
// empty the hall without the level clearing on the same tick, because `poseHall`
// holds the inlet and leaves the quota unexhausted: `specs/progression.md` clears
// a level "the moment its quota is exhausted and no cores remain on the channel",
// and a clear "adds 500 to the score", which would take the figure off 50.
//
// HOW THE FIGURE IS READ. `specs/ui.md` fixes no font, no layout and no copy, so
// a build may draw "SCORE 50" in one call or lay the readout down a glyph at a
// time, and both are the same picture to a player. `drewFigure` reads the digits
// of each logical run the frame spells — the package's merge of side-by-side
// glyphs on one baseline back into the string they spell — so a readout of "50",
// "SCORE 50" and one drawn glyph by glyph all answer the same, while "504" does
// not.

import { afterEach, beforeEach, it } from "vitest";
import { extractionScore } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";
import { drewFigure } from "./readouts";

/** The head of the run, in units from the inlet: see `./extract.ts` for the aim. */
const HEAD_S = 350;

/** The charge the run is made of. */
const RUN_CHARGE = "halide" as const;

/** Four posed plus the one released: an extraction of five at chain step 1. */
const RUN_SIZE = 5;
const CHAIN_STEP = 1;

/** `10 x 5 x 1`. */
const EXPECTED_SCORE = extractionScore(RUN_SIZE, CHAIN_STEP);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the score an extraction paid", async () => {
  await poseHall(h, {
    level: 1,
    cores: spacedRun(HEAD_S, [RUN_CHARGE, RUN_CHARGE, RUN_CHARGE, RUN_CHARGE]),
    loaded: RUN_CHARGE,
  });
  await fireAt(h, 270);

  const scored = await h.stepUntil((snapshot) => snapshot.score > 0, {
    maxTicks: 90,
    poll: 1,
  });
  const calls = await h.lastCalls();
  await captureStill(h, "hud");

  assertEqual(
    scored.snapshot.screen,
    "playing",
    "the screen the extraction left",
  );
  assertTrue(
    drewFigure(calls, EXPECTED_SCORE),
    `the score drawn on the HUD (the run scored ${scored.snapshot.score})`,
  );
});
