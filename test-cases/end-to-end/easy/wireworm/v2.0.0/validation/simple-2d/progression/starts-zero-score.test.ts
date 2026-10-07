// progression/starts-zero-score — a new run opens with the score at zero.
//
// THE RULE. `specs/progression.md`, *Starting a run*: a new run opens with Score
// `0`. `specs/scoring.md` says the same from the other side — *a run carries one
// running score, starting at `0`*.
//
// HOW THE POSE MAKES THE READING MEAN SOMETHING. A build that has scored nothing
// is already at zero, so the title is posed carrying the score of a run that has
// just ended, and the reading is that opening a new one threw it away. A build
// that carries the total over reads the posed figure; only a build that starts the
// score afresh reads `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The score a new run opens at (specs/progression.md, specs/scoring.md). */
const OPENING_SCORE = 0;

/**
 * The score the title is posed carrying. An ordinary end-of-run total, and not a
 * multiple of `BONUS_LIFE_EVERY` (`12,000`), so nothing about it could be confused
 * with the bonus-life award — which `setScore` grants no part of in any case
 * (specs/instrumentation.md).
 */
const STALE_SCORE = 4321;

/** The first entry of `TITLE_ITEMS`, which is `DESCEND` (specs/ui.md). */
const DESCEND = 0;

/** A key bound to `confirm` in `BINDINGS` (specs/controls.md). */
const CONFIRM_KEY = "Enter";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("opens a run with the score back at zero", async () => {
  const { debug } = harness;
  debug.setScreen("title");
  debug.setMenuIndex(DESCEND);
  debug.setScore(STALE_SCORE);

  await harness.tap(CONFIRM_KEY);

  captureStill(harness, "opening");
  assertEqual(harness.snapshot().score, OPENING_SCORE);
});
