// instrumentation/cleared-and-best-are-independent — the cleared mark and the
// best score are two facts, not one.
//
// specs/state.md § The session: "Per site: whether it has ever been cleared this
// session, and the best score recorded on it, a `cost` and a `time`, or none
// before the first clear. The two are set independently: a site can be marked
// cleared without a score and can carry a score without being marked cleared."
//
// specs/instrumentation.md gives one operation per fact — `setCleared(index,
// cleared)`, `setBest(index, cost, time)` and `clearBest(index)` — so the
// scenario is simply each of them on a site of its own, read back from the
// snapshot's two per-site lists. Two sites rather than one, because a build that
// keeps the score inside the cleared mark fails differently depending on which
// was written first, and both orders are here: site 1 is marked cleared and never
// scored, site 3 is scored and never marked.
//
// `clearBest` closes the loop from the other side: returning a site to having no
// recorded score must not un-mark, or mark, anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The site marked cleared and never scored. */
const MARKED = 0;
/** The site scored and never marked cleared. */
const SCORED = 2;

const SCORE = { cost: 4000, time: 60 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks a site cleared without a score and scores one without marking it", async () => {
  try {
    // The harness opens on a reset, so every site is uncleared with no score.
    const opening = await h.snapshot();
    assertEqual(opening.cleared[MARKED], false, `site ${MARKED + 1} before`);
    assertNull(opening.best[SCORED], `site ${SCORED + 1}'s score before`);

    await h.debug.setCleared(MARKED, true);
    const marked = await h.snapshot();
    assertEqual(
      marked.cleared[MARKED],
      true,
      `site ${MARKED + 1}'s cleared mark, set on its own`,
    );
    assertNull(
      marked.best[MARKED],
      `site ${MARKED + 1}'s recorded score: a site can be marked cleared ` +
        "without one (specs/state.md)",
    );

    await h.debug.setBest(SCORED, SCORE.cost, SCORE.time);
    const scored = await h.snapshot();
    assertDeepEqual(
      scored.best[SCORED],
      SCORE,
      `site ${SCORED + 1}'s recorded score, set on its own`,
    );
    assertEqual(
      scored.cleared[SCORED],
      false,
      `site ${SCORED + 1}'s cleared mark: a site can carry a score without ` +
        "being marked cleared (specs/state.md)",
    );

    await h.debug.clearBest(SCORED);
    const cleared = await h.snapshot();
    assertNull(cleared.best[SCORED], `site ${SCORED + 1}'s score, cleared`);
    assertEqual(
      cleared.cleared[SCORED],
      false,
      `site ${SCORED + 1}'s cleared mark across a clearBest`,
    );
    assertEqual(
      cleared.cleared[MARKED],
      true,
      `site ${MARKED + 1}'s cleared mark across another site's clearBest`,
    );
  } finally {
    // The select screen is where the two facts are shown side by side
    // (specs/ui.md), so that is the picture a reviewer is handed — and it is
    // taken in a `finally`, so a check that fails still leaves the picture that
    // shows why.
    await h.debug.setScreen("select");
    await h.advance(1);
    await h.capture("independent", "The two per-site facts");
  }
});
