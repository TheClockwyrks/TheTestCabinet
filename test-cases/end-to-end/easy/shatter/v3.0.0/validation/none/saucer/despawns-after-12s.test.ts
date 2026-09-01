// Shatter — saucer/despawns-after-12s: a visit is finite.
//
// THE RULE. `specs/saucer.md`: "A saucer leaves the field `SAUCER_LIFETIME` (`12`
// seconds) after it enters." `specs/instrumentation.md` has `addSaucer` bring one
// on with "its own lifetime clock at zero", so a saucer posed here has the whole
// twelve seconds ahead of it and the reading is a bracket around the moment it runs
// out: still up at `11.5` s, gone by `12.5` s.
//
// HALF A SECOND EITHER SIDE, which is four percent of the figure and the item's
// own. Nothing conformant needs it — the clock is a count of ticks either way — and
// every neighbouring figure in this specification fails it: the `18`-second first
// arrival is six seconds over the ceiling and the `1.6`-second fire interval is ten
// under the floor, so a build that confused the lifetime with either is caught.
//
// ITS MIND AND ITS GUN ARE OFF, AND ITS LIFETIME IS NOT A FACULTY. The three gates
// `specs/instrumentation.md` gives the saucer are its steering, its gun and its
// locomotion, and none of them is its clock, so a saucer with two of them off still
// leaves on time. Switching them off is what keeps the reading clean: the weave
// would carry it across rows and the gun would leave rounds on the field the
// departure then has to be told apart from.
//
// WHERE IT IS FLOWN. Along the row `y = 660`, `300` units below the star's, from
// `x = 100`: the `1680` units twelve seconds of cruise covers wraps it once around
// the field, and every part of that lap holds `300` units of clearance from the
// star's centre. That matters because the mind that would otherwise steer it clear
// of the core is switched off.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { SAUCER_LIFETIME } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the visit is flown: a row well below the star. */
const START = { x: 100, y: 660 };

/** Half a second either side of `SAUCER_LIFETIME`, the item's own bracket. */
const BRACKET = 0.5;

/** The moment it must still be up: `11.5` s of game time. */
const BEFORE_TICKS = ticksFor(SAUCER_LIFETIME - BRACKET);

/** The moment it must be gone by: `12.5` s. */
const AFTER_TICKS = ticksFor(SAUCER_LIFETIME + BRACKET);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the field between 11.5 s and 12.5 s after it arrives", async () => {
  await startPlaying(h);
  await poseSaucer(h, START.x, START.y, { mind: false, gun: false });

  await h.skip(BEFORE_TICKS);
  assertNotNull(
    (await h.snapshot()).saucer,
    `the saucer ${SAUCER_LIFETIME - BRACKET} s into its visit, before its lifetime is up (specs/saucer.md)`,
  );

  await h.skip(AFTER_TICKS - BEFORE_TICKS);
  const gone = await h.snapshot();
  await captureStill(h, "departure");

  assertNull(
    gone.saucer,
    `the field ${SAUCER_LIFETIME + BRACKET} s into a visit that lasts ${SAUCER_LIFETIME} (specs/saucer.md)`,
  );
});
