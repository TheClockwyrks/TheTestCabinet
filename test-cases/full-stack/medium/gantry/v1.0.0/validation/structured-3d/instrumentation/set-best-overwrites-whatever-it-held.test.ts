// instrumentation/set-best-overwrites-whatever-it-held — setBest records the
// score whatever the site held, so it overwrites a better one.
//
// `specs/instrumentation.md` § The run and the screens: "`setBest(index, cost,
// time)` records `{ cost, time }` as site `index`'s best score, whatever it
// held." The last three words are the requirement: the pose is not the game's own
// best-keeping rule, which records the crane's cost and the run clock of a clear
// (`specs/program.md`) and would have no reason to replace a better score with a
// worse one.
//
// SO THE SECOND SCORE IS WORSE THAN THE FIRST ON BOTH FIGURES: a crane costing
// `9000` against `2400`, over a run clock of `900` seconds against `55`. A build
// that guarded the write behind any comparison of the two — cost, time, or both —
// keeps the first score and fails here, while a build that simply records what it
// was given passes. The site is not site 0, so a misdirected write shows as well.
//
// The poses are made from the title screen, where the harness's opening reset
// leaves the game: `specs/instrumentation.md` says of the first eight operations
// of its table, `setBest` among them, that they "apply on every screen".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { createHarness, type Harness } from "../harness";

/** A site other than the one a reset opens, so a misdirected write shows. */
const SITE = 1;

/** The score already standing: cheaper and quicker than the one that follows. */
const HELD = { cost: 2400, time: 55 };

/** Worse on both figures, so no comparison of the two would let it through. */
const POSED = { cost: 9000, time: 900 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("overwrites a better score with the one it is given", async () => {
  await h.debug.setBest(SITE, HELD.cost, HELD.time);
  const held = (await h.snapshot()).best[SITE];
  assertEqual(
    held?.cost,
    HELD.cost,
    "the better score standing before the pose",
  );
  assertEqual(
    held?.time,
    HELD.time,
    "the better score standing before the pose",
  );

  await h.debug.setBest(SITE, POSED.cost, POSED.time);
  const best = (await h.snapshot()).best[SITE];
  await h.advance(1);
  await h.capture("best", "The score setBest recorded over a better one");

  assertNotNull(best, `the score site ${SITE} carries after the second pose`);
  assertEqual(
    best?.cost,
    POSED.cost,
    "the cost setBest recorded over a better one (specs/instrumentation.md)",
  );
  assertEqual(
    best?.time,
    POSED.time,
    "the time setBest recorded over a better one (specs/instrumentation.md)",
  );
});
