// Meltdown — screens/play-again-focused-on-gameover: the gameover screen opens on
// PLAY AGAIN.
//
// THE RULE. specs/screens.md's "What is highlighted on arrival": arriving at
// `gameover` from `playing` highlights `PLAY AGAIN`, row `0`.
// specs/instrumentation.md reports the highlighted row as `menuIndex`.
//
// ONE SCREEN, BECAUSE THE TWO ARE TWO TRANSITIONS. specs/waves.md wins a run by
// clearing the final wave with at least one life left and loses it the moment the
// lives reach `0`, so the two end screens open down separate paths and a build
// that puts the highlight back on one and not the other must not grade as one
// that does neither. The other screen is
// `screens.play-again-focused-on-victory`'s.
//
// THE ENTRY EFFECT IS THE REQUIREMENT, SO THE TRANSITION IS REACHED THE WAY THE
// RUN REACHES IT. `setScreen` "sets that field alone and runs no entry effect"
// (specs/instrumentation.md), so a scenario that posed `gameover` would be reading
// the pose rather than the opening; a build that never moves its highlight would
// pass such a check whenever the field happened to be `0` already.
//
// A LEAK REACHES IT. specs/waves.md clears a wave "on the frame in which its last
// live unit dies or leaks with none of it left to release", and a leak costs lives
// (specs/surge.md). So one arrangement — a walker one tile short of its exhaust,
// under its own power — reaches the loss when the run is down to its last life. Nothing has to implement a
// player: the unit walks out on the game's own rules.
//
// THE HIGHLIGHT IS POSED AWAY FROM ROW `0` FIRST, and that is what makes the
// reading mean anything. Posed on the LAST row of the end menu, a build that
// carries the highlight through the transition reads that row, a build that clamps
// it into range reads that row too, and only a build that puts the highlight back
// on `PLAY AGAIN` reads `0`.
//
// THE RUN IS POSED ON ITS LAST LIFE AND ON WAVE 1, so the loss is what the leak
// reaches rather than a wave clear: specs/waves.md ends the run "whatever the
// phase" the moment the lives reach `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COLS, ENDING_ITEMS, RIGHT_EXHAUST_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  ticksFor,
  tileCenter,
  type Harness,
} from "../harness";

/** The row an end screen must open on: `PLAY AGAIN`, the first of `ENDING_ITEMS`. */
const PLAY_AGAIN_ROW = ENDING_ITEMS.indexOf("PLAY AGAIN");

/**
 * The row the highlight is posed on before the transition: the end menu's last.
 *
 * In range for the menu that is about to open, so a build that clamps rather than
 * resets is caught, and different from `PLAY_AGAIN_ROW`, so a build that leaves
 * the highlight alone is caught too.
 */
const POSED_ROW = ENDING_ITEMS.length - 1;

/** The lives this leg is posed with. */
const LIVES = 1;

/**
 * The tile the walker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * specs/floor.md puts the right exhaust on the last column's rows `16` to `19`,
 * and a unit entering at the left vent is assigned the right exhaust for its whole
 * life, so a walker posed here has one tile left to travel.
 */
const LEAK_TILE = { col: COLS - 2, row: RIGHT_EXHAUST_ROWS[1] } as const;

/**
 * How long the walk out is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far
 * a build may miss a figure by. A Mote's specified `60` logical units per second
 * covers the one tile it has left in about a third of a second (specs/surge.md),
 * so three seconds carries a build walking at a ninth of that speed out through
 * the opening.
 */
const LEAK_TICKS = ticksFor(3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the gameover screen with the highlight on PLAY AGAIN", async () => {
  startRun(h);
  const wave = 1;
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  h.debug.setLives(LIVES);
  h.debug.setMenuIndex(POSED_ROW);

  const walker = poseWalker(h, "mote", "left");
  const at = tileCenter(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(walker, at.x, at.y);

  const swept = await h.until((snapshot) => snapshot.screen !== "playing", {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  captureStill(h, "focused");

  assertEqual(
    swept.snapshot.screen,
    "gameover",
    `precondition: the run's last life was leaked away`,
  );
  assertEqual(
    swept.snapshot.menuIndex,
    PLAY_AGAIN_ROW,
    `the highlighted row the gameover screen opened on, from a run posed on ` +
      `row ${POSED_ROW}`,
  );
});
