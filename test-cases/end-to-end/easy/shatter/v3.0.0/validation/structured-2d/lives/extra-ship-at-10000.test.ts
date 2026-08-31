// lives/extra-ship-at-10000 — crossing 10,000 through play grants a ship.
//
// THE RULE. `specs/scoring.md`: "One extra ship is granted each time the score
// crosses a multiple of `EXTRA_LIFE_STEP` (`10 000`) THROUGH PLAY, so at
// `10 000`, at `20 000`, and on each multiple after that." This item decides the
// FIRST multiple. The award repeating at the next one is
// `lives/extra-ship-at-20000`, so a build that grants one ship and then never
// another loses one point rather than two.
//
// THE CROSSING IS MADE BY A REAL KILL, and it has to be: `specs/instrumentation.md`
// states that "`setScore` grants no extra ship, whatever multiple of
// `EXTRA_LIFE_STEP` it carries the score across", so a scenario that posed the
// score across the line would be asserting the opposite of what the surface is
// specified to do. The score is posed just BELOW the line and a Small is shot
// down for real — through `addBullet` and the build's own collision, split and
// scoring code — which pays `SCORE_SMALL` (100) and carries the total from
// 9,950 to 10,050.
//
// WHY 9,950 AND NOT 9,900. The rule says the score CROSSES the multiple, and a
// kill that lands exactly on 10,000 leaves a build free to argue it has not
// crossed anything yet. Fifty short of the line puts the crossing beyond
// argument: 9,950 is under the multiple and 10,050 is over it.
//
// WHAT IS READ. The DIFFERENCE the kill made to the ship count, not the count
// itself, so the reading is the award alone. Whatever a build did or did not do
// when the score was posed is the baseline this measures from, and
// `instrumentation/set-score-grants-no-life` is where posing the score is
// decided.
//
// EXACTLY ONE, because the crossing is one multiple: a build that grants a ship
// per point of the payment, or one per multiple below the score rather than per
// multiple crossed, grants more.
//
// The field holds one Small and nothing else, both world gates are shut, and the
// ship's contact test is off, so nothing but the kill can move either counter.

import { afterEach, beforeEach, it } from "vitest";
import { EXTRA_LIFE_STEP, SCORE_SMALL } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  shootFieldDown,
  startPlaying,
  type Harness,
} from "../harness";
import { DUEL } from "./duel";

/** The multiple the crossing is made across. */
const MULTIPLE = EXTRA_LIFE_STEP;

/** How far below the multiple the score is posed, in points. */
const RUN_UP = 50;

/** The ships one crossing grants. */
const AWARD = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grants one ship when a kill carries the score across 10,000", async () => {
  startPlaying(h);
  h.debug.setScore(MULTIPLE - RUN_UP);
  // Quiet ground, far from the star: what the well does to a drifting rock is
  // `gravity/`'s subject, and a rock at rest out here barely moves before the
  // round reaches it.
  h.debug.addRock("small", DUEL.x, DUEL.y);

  const armed = h.snapshot();
  assertEqual(
    armed.score,
    MULTIPLE - RUN_UP,
    "setScore to be reported by the snapshot before the kill " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    armed.rocks,
    1,
    "one rock on the field, so the kill below pays exactly one figure " +
      "(specs/scoring.md)",
  );
  const before = armed.lives;

  await shootFieldDown(h);
  const paid = h.snapshot();
  captureStill(h, "award");

  assertEqual(
    paid.score,
    MULTIPLE - RUN_UP + SCORE_SMALL,
    "the score after a Small was destroyed, which pays SCORE_SMALL and " +
      "carries the total across the multiple (specs/scoring.md)",
  );
  assertEqual(
    paid.lives - before,
    AWARD,
    "the ships the crossing granted — one extra ship each time the score " +
      "crosses a multiple of EXTRA_LIFE_STEP through play (specs/scoring.md)",
  );
});
