// lives/extra-ship-at-20000 — the award repeats at the next multiple.
//
// THE RULE. `specs/scoring.md`: "One extra ship is granted EACH TIME the score
// crosses a multiple of `EXTRA_LIFE_STEP` (`10 000`) through play, so at
// `10 000`, at `20 000`, AND ON EACH MULTIPLE AFTER THAT." The first crossing is
// `lives/extra-ship-at-10000`; this item decides that the award is a repeating
// rule rather than a one-off, so a build that grants a ship at 10,000 and never
// again fails exactly this one.
//
// WHY THE RUN CROSSES 10,000 FIRST. Because a check that only ever crossed
// 20,000 would not decide the repetition at all: a build holding a single
// "extra ship granted" flag would arrive at 20,000 with that flag unset — the
// score having been posed rather than played there — and would grant a ship for
// the first and only time. So this run makes the first crossing FOR REAL, with a
// kill, spending whatever a build has to spend, and only then poses the score
// under the second multiple and crosses it with a second kill.
//
// The first crossing is arrangement, not the reading. What is asserted is the
// difference the SECOND kill made to the ship count, measured from the count as
// it stood after the first award, so a build that muffed the first crossing
// loses `lives/extra-ship-at-10000` and is still measured honestly here.
//
// Both crossings are made by shooting a Small down for real, through `addBullet`
// and the build's own scoring path, because `specs/instrumentation.md` grants no
// ship for a posed score. Each kill pays `SCORE_SMALL` (100) and carries the
// total 50 points below a multiple to 50 above it.
//
// The field holds one Small at a time and nothing else, both world gates are
// shut, and the ship's contact test is off.

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

/** The multiple this item's reading is taken across: the second one. */
const MULTIPLE = EXTRA_LIFE_STEP * 2;

/** How far below a multiple the score is posed, in points. */
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

it("grants a ship at the second multiple as well as the first", async () => {
  startPlaying(h);

  // The first crossing, made for real so that whatever a build spends on an
  // award has been spent before the reading below is taken.
  h.debug.setScore(EXTRA_LIFE_STEP - RUN_UP);
  h.debug.addRock("small", DUEL.x, DUEL.y);
  await shootFieldDown(h);
  const crossed = h.snapshot();
  assertEqual(
    crossed.score,
    EXTRA_LIFE_STEP - RUN_UP + SCORE_SMALL,
    "the score after the first crossing's kill, which pays SCORE_SMALL " +
      "(specs/scoring.md)",
  );

  // The second crossing: the reading.
  h.debug.setScore(MULTIPLE - RUN_UP);
  h.debug.addRock("small", DUEL.x, DUEL.y);

  const armed = h.snapshot();
  assertEqual(
    armed.score,
    MULTIPLE - RUN_UP,
    "setScore to be reported by the snapshot before the second kill " +
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
    "the score after the second Small was destroyed, which carries the " +
      "total across the second multiple (specs/scoring.md)",
  );
  assertEqual(
    paid.lives - before,
    AWARD,
    "the ships the second crossing granted — one extra ship each time the " +
      "score crosses a multiple of EXTRA_LIFE_STEP (specs/scoring.md)",
  );
});
