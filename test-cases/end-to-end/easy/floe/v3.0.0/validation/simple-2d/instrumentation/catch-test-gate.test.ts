// instrumentation/catch-test-gate — `setCatchTest(false)` holds the one rule that
// makes a bear reaching the critter cost a life, and turning it back on costs one.
//
// specs/instrumentation.md fixes the gate: "Whether a bear reaching the critter
// costs a life. The bears still sense, route, travel, and draw." specs/hunter.md
// fixes the rule it gates: "A bear catches the critter, while the critter is in
// play, when the straight-line distance between their centers ... is at most
// `BEAR_CATCH_DIST` (`18`) stage units", and specs/progression.md fixes what that
// costs — `lives` drops by one and `phase` becomes `dying`.
//
// SO THE SAME SCENARIO IS POSED TWICE AND THE GATE IS THE ONLY DIFFERENCE. A bear
// is settled on the critter's own tile, which puts the two centres at a distance of
// zero — as far inside `BEAR_CATCH_DIST` as the strait allows — and the strait is
// then left running for a second. With the gate off, the run must be exactly where
// it started; with it on, a life must go.
//
// EVERY OTHER SCENARIO IN THIS SUITE RESTS ON THE FIRST HALF. `startCrossing` shuts
// this gate so that a posed bear can stand beside the critter while a check reads
// something else, and a build that ignored it would end those crossings under a
// heading about the mechanic they were posed for.
//
// THE BEAR IS POSED WITH ALL THREE FACULTIES OFF, so it is a body at a distance and
// nothing more: it neither senses, routes nor travels, and the reading is of the
// catch test alone rather than of a pursuit that happened to arrive. Whether a bear
// that TRAVELS to the critter catches it is `hunter/catches`', and what a catch
// costs is `progression/catch-costs-life`'s; this point decides the gate.

import { afterEach, beforeEach, it } from "vitest";
import { BEAR_CATCH_DIST, START_LIVES, TICK_HZ } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  type Harness,
} from "../harness";

/** The tile both the critter and the bear are posed on, in the ice band. */
const TILE_COL = 20;
const TILE_ROW = 15;

/**
 * The span each half of the scenario runs for, in ticks: the one second this item
 * names.
 *
 * specs/hunter.md tests the distance on every tick while the critter is in play, so
 * a build whose catch test runs at all has run it a hundred and twenty times by the
 * end of it.
 */
const SPAN_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life with the catch test gated off, and one with it on", async () => {
  /**
   * Pose the bear on the critter's centre with the gate as asked, and hand back
   * the tile both bodies stand on.
   *
   * All three faculties are held off, so what the second below measures is the
   * catch test and not a pursuit.
   */
  const poseTheCatch = (enabled: boolean): void => {
    startCrossing(h);
    h.debug.setCritterTile(TILE_COL, TILE_ROW);
    poseBear(h, TILE_COL, TILE_ROW, {
      sense: false,
      routing: false,
      travel: false,
    });
    h.debug.setCatchTest(enabled);
  };

  const both = await captureReplay(h, "gate", async () => {
    poseTheCatch(false);
    const posed = h.snapshot();
    await h.advance(SPAN_TICKS);
    const gated = h.snapshot();

    poseTheCatch(true);
    const tested = await h.until((s) => s.lives < START_LIVES, {
      maxFrames: SPAN_TICKS,
    });
    return { posed, gated, tested };
  });

  assertEqual(
    Math.hypot(
      both.posed.bears[0].x - both.posed.critter.x,
      both.posed.bears[0].y - both.posed.critter.y,
    ),
    0,
    `the stage units between the posed bear's centre and the critter's, which ` +
      `specs/hunter.md catches within BEAR_CATCH_DIST (${BEAR_CATCH_DIST}) — a ` +
      `scenario posed any further apart would decide nothing`,
  );

  assertEqual(
    both.gated.lives,
    START_LIVES,
    `the lives left after ${SPAN_TICKS / TICK_HZ} s of a bear standing on the ` +
      `critter's centre with setCatchTest(false) — the gate holds whether a bear ` +
      `reaching the critter costs a life (specs/instrumentation.md)`,
  );
  assertEqual(
    both.gated.phase,
    "crossing",
    `the phase over that same span — a life lost would have taken it to "dying" ` +
      `(specs/progression.md)`,
  );

  assertTrue(
    both.tested.hit,
    `a life to be lost within ${SPAN_TICKS / TICK_HZ} s of the same scenario ` +
      `with setCatchTest(true) — the bear's centre is on the critter's, which is ` +
      `inside BEAR_CATCH_DIST (${BEAR_CATCH_DIST}) (specs/hunter.md)`,
  );
  assertEqual(
    both.tested.snapshot.lives,
    START_LIVES - 1,
    "the lives left once the catch test is running, which drops by exactly one " +
      "(specs/progression.md)",
  );
  assertEqual(
    both.tested.snapshot.phase,
    "dying",
    "the phase the catch left the crossing in (specs/progression.md)",
  );
});
