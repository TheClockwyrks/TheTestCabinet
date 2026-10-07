// scoring/level-clear-bonus — clearing a level pays 100 times the level.
//
// `specs/scoring.md`'s table: "A level is cleared" pays `SCORE_LEVEL_CLEAR`
// (`100 * level`), "for the level just cleared". `specs/progression.md` fixes
// when that happens: "A level clears on the step in which the last of its worm
// segments is removed", and the clear bonus is the first thing the clear pays.
//
// WHY THIS POINT READS A DIFFERENCE RATHER THAN A TOTAL. The removal that clears
// a level is itself a kill, and the kill pays its own figure
// (`scoring.head-segment`), so a point asserting a total would be asserting that
// figure too — a build with a correct clear bonus and a wrong kill figure would
// fail both items, and a grade could no longer say which one the build got wrong.
// Two kills are driven instead, identical in every way that could pay: each is a
// bolt into the single segment of a one-segment worm, which is a head
// (`specs/worm.md`: "A worm of one segment is a head alone"). The first leaves
// another worm standing, so it clears nothing; the second empties the board, so
// it clears the level. The DIFFERENCE between what they paid is the clear bonus
// alone, whatever a kill is worth on this build.
//
// THE LEVEL IS `4`, so the figure under test is `400` rather than the `100` a
// level-1 board would pay — a build that pays a flat bonus rather than one that
// scales with the level reads `100` here and is caught, which it would not be at
// level `1`.
//
// The two worms stand in different columns, so the fresh inert node the first
// kill leaves behind (`specs/nodes.md`) is nowhere near the second bolt's climb.
// Both are posed with their faculties off: this point is about what a clear PAYS,
// not about where a worm walks.
//
// WHAT EVERY WRONG MODEL READS. A build that pays a flat bonus reads `100`; one
// that pays for the level it is ABOUT to open rather than the one just cleared
// reads `500`; one that pays no clear bonus at all reads `0`. Each is a different
// number from `400`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_LEVEL_CLEAR } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The level the board is posed on, and so the level whose clear is paid for. */
const LEVEL = 4;

/** The worm whose death clears nothing, because the other one is still standing. */
const FIRST = { c: 12, r: 8 };

/** The worm whose death empties the board, and so clears the level. */
const SECOND = { c: 20, r: 8 };

/**
 * What the clear must add beyond what the kill itself paid.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_LEVEL_CLEAR * LEVEL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 100 times the level on top of the kill that cleared it", async () => {
  await startPlaying(h, { level: LEVEL });
  await poseWorm(h, {
    c: FIRST.c,
    r: FIRST.r,
    segments: [FIRST],
    stepping: false,
    body: false,
  });
  await poseWorm(h, {
    c: SECOND.c,
    r: SECOND.r,
    segments: [SECOND],
    stepping: false,
    body: false,
  });

  const start = (await h.snapshot()).score;
  await shootInto(h, FIRST.c, FIRST.r);
  const between = (await h.snapshot()).score;
  await shootInto(h, SECOND.c, SECOND.r);

  await captureStill(h, "scored");
  const end = (await h.snapshot()).score;
  assertEqual(
    end - between - (between - start),
    EXPECTED,
    "the points the level-4 clear paid beyond the kill",
  );
});
