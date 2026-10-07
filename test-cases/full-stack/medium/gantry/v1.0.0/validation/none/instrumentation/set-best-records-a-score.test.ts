// instrumentation/set-best-records-a-score — setBest records a site's best score.
//
// `specs/instrumentation.md` § The run and the screens: "`setBest(index, cost,
// time)` records `{ cost, time }` as site `index`'s best score, whatever it
// held." `specs/state.md` says what the snapshot reports it as: "Per site: …
// the best score recorded on it, a `cost` and a `time`, or none before the first
// clear", read back as `best[index]`.
//
// THE SITE IS NOT SITE 0, and the two figures are not equal, so a build that
// wrote the score onto the wrong site, or crossed the cost with the time, fails.
// The check reads what a reset leaves first — "every site uncleared with no
// recorded score" — so the score it goes on to read is one this pose put there
// and not one that was already standing.
//
// The pose is made from the title screen, where the harness's opening reset
// leaves the game: `specs/instrumentation.md` says of the first eight operations
// of its table, `setBest` among them, that they "apply on every screen". Nothing
// is opened, built, or run on the way, because none of that is what this
// requirement is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { createHarness, type Harness } from "../harness";

/** A site other than the one a reset opens, so a misdirected write shows. */
const SITE = 1;

/** Two figures that cannot be confused for one another. */
const SCORE = { cost: 2400, time: 55 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records the score it is given as a site's best", async () => {
  assertNull(
    (await h.snapshot()).best[SITE],
    `the score site ${SITE} carries before the pose`,
  );

  await h.debug.setBest(SITE, SCORE.cost, SCORE.time);
  const best = (await h.snapshot()).best[SITE];
  await h.advance(1);
  await h.capture("best", "The score setBest recorded");

  assertNotNull(best, `the score setBest recorded on site ${SITE}`);
  assertEqual(
    best?.cost,
    SCORE.cost,
    "the cost setBest recorded (specs/instrumentation.md)",
  );
  assertEqual(
    best?.time,
    SCORE.time,
    "the time setBest recorded (specs/instrumentation.md)",
  );
});
