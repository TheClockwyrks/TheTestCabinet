// progression/clear-bonus — a cleared level scores its bonus.
//
// THE SPEC LINE. `specs/progression.md` — "Clearing a level": "Every clear adds
// 500 to the score." (`CLEAR_BONUS`.) The extraction that empties the channel
// pays its own value on the same tick: `specs/extraction.md` — "An extraction of
// `n` cores at chain step `k` adds `10 x n x k` to the score", and "Extraction on
// an insertion ... scores at chain step 1", the step a level begins at
// (`specs/progression.md`: "the chain step at 1").
//
// THE DRIVE. `clearing.ts` poses level 1 with its quota spent and one run of
// three matching cores, and fires a matching core into them; the insertion
// extracts the whole run and the empty channel clears the level, both on that
// tick.
//
// HOW `n` IS READ RATHER THAN ASSUMED. The count is taken off the last tick that
// still carried cores, plus the one core the shot inserted — so the sum this
// suite expects is the extraction the build actually made plus the bonus, and a
// build that seats the shot a tick earlier or later, or resolves the clear on the
// tick after the extraction rather than on it, is judged on its own run. That
// keeps this point about the 500 rather than about the extraction's own
// arithmetic, which is `extraction/`'s to decide.
//
// TOLERANCES. None. A score is a whole number the standing tolerances make exact
// ("count, score, charge id, screen | exact"), and the claim is an exact sum. The
// sweep's 90-tick ceiling is the same one `clearing.ts` explains: it covers the
// flight several times over and stays inside the 2 s interlude a clear opens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import { CLEAR_BONUS, extractionScore } from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  type Harness,
} from "../harness";
import { driveClear, poseClearingHall } from "./clearing";

/** Levels 1 through 4 clear to `cleared`; level 5 is `progression/victory`. */
const LEVEL = 1;

/** "Extraction on an insertion | 1" — the step a level begins at. */
const CHAIN_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds 500 on top of the clearing extraction's own value", async () => {
  await poseClearingHall(h, LEVEL);

  const drive = await driveClear(h);
  captureStill(h, "bonus");

  assertEqual(
    coreCount(drive.ended),
    0,
    "no core left on the channel once the run was extracted",
  );
  assertEqual(drive.ended.screen, "cleared", "the screen on the clearing tick");

  // The last tick that still carried cores: every one of them left on the
  // clearing extraction, along with the core the shot inserted into them.
  const carrying = [...drive.history]
    .reverse()
    .find((snapshot) => coreCount(snapshot) > 0);
  assertTruthy(carrying, "a tick carrying cores before the channel emptied");
  const before = carrying ?? drive.before;
  const extracted = coreCount(before) + 1;
  assertEqual(
    drive.ended.score - before.score,
    extractionScore(extracted, CHAIN_STEP) + CLEAR_BONUS,
    `the score the clearing tick added for ${extracted} cores plus the clear bonus`,
  );
});
