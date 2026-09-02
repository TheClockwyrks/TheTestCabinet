// Meltdown — screens/play-again-focused: an end screen opens on PLAY AGAIN.
//
// THE RULE. specs/screens.md, `victory` and `gameover`: both "open with the
// highlight on `PLAY AGAIN`, at row `0`." specs/instrumentation.md reports the
// highlighted row as `menuIndex`.
//
// THE ENTRY EFFECT IS THE REQUIREMENT, SO THE TRANSITION IS REACHED THE WAY THE
// RUN REACHES IT. `setScreen` "sets that field alone and runs no entry effect"
// (specs/instrumentation.md), so a scenario that posed `victory` would be reading
// the pose rather than the opening; a build that never moves its highlight would
// pass such a check whenever the field happened to be `0` already. Both screens
// are therefore reached through the game's own transitions: specs/waves.md ends a
// run in victory when the final wave clears with at least one life left, and in
// loss the moment the lives reach `0`.
//
// A LEAK REACHES BOTH. specs/waves.md clears a wave "on the frame in which its
// last live unit dies or leaks with none of it left to release", and a leak costs
// lives (specs/surge.md). So one arrangement — a walker one tile short of its
// exhaust, under its own power — reaches the victory when it is the last unit of
// the last wave with lives in hand, and the loss when the run is down to its last
// life. Nothing has to implement a player: the unit walks out on the game's own
// rules.
//
// THE HIGHLIGHT IS POSED AWAY FROM ROW `0` FIRST, and that is what makes the
// reading mean anything. Posed on the LAST row of the end menu, a build that
// carries the highlight through the transition reads that row, a build that clamps
// it into range reads that row too, and only a build that puts the highlight back
// on `PLAY AGAIN` reads `0`.
//
// BOTH SCREENS, because specs/screens.md states the rule of "either" of them and a
// build that resets the highlight on one path and not the other is an ordinary
// defect. The failure names the screen that opened on the wrong row.
//
// THE LIVES ARE THE ONLY DIFFERENCE BETWEEN THE TWO LEGS: eight in hand carries
// the leak into a victory, one carries the same leak into a loss. specs/waves.md
// is explicit that a leak taking the lives to `0` on the final wave "ends the run
// in loss, not in victory", so the winning leg is posed well clear of that.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ENDING_ITEMS, RIGHT_EXHAUST_ROWS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  ticksFor,
  tileCenter,
  type Harness,
  type Screen,
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

/** The lives each leg is posed with: enough to win on, and the last one. */
const LIVES_TO_WIN = 8;
const LIVES_TO_LOSE = 1;

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

/**
 * Open a run posed on the end menu's last row, walk one unit out of its exhaust,
 * and hand back the screen that opened.
 *
 * `wave` is the wave the run is on and `lives` what it has in hand: the final wave
 * with lives to spare ends in victory, and any wave with the last life ends in
 * loss.
 */
async function leakInto(
  wave: number,
  lives: number,
): Promise<{ screen: Screen; menuIndex: number }> {
  startRun(h);
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  h.debug.setLives(lives);
  h.debug.setMenuIndex(POSED_ROW);

  const walker = poseWalker(h, "mote", "left");
  const at = tileCenter(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(walker, at.x, at.y);

  const swept = await h.until((snapshot) => snapshot.screen !== "playing", {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  return { screen: swept.snapshot.screen, menuIndex: swept.snapshot.menuIndex };
}

it("opens both end screens with the highlight on PLAY AGAIN", async () => {
  const finalWave = (() => {
    startRun(h);
    return h.snapshot().waveCount;
  })();

  const won = await leakInto(finalWave, LIVES_TO_WIN);
  const lost = await leakInto(1, LIVES_TO_LOSE);
  captureStill(h, "focused");

  assertEqual(
    won.screen,
    "victory",
    `precondition: the last of wave ${finalWave} left the floor with ` +
      `${LIVES_TO_WIN} lives in hand`,
  );
  assertEqual(
    won.menuIndex,
    PLAY_AGAIN_ROW,
    `the highlighted row the victory screen opened on, from a run posed on ` +
      `row ${POSED_ROW}`,
  );

  assertEqual(
    lost.screen,
    "gameover",
    `precondition: the run's last life was leaked away`,
  );
  assertEqual(
    lost.menuIndex,
    PLAY_AGAIN_ROW,
    `the highlighted row the game-over screen opened on, from a run posed on ` +
      `row ${POSED_ROW}`,
  );
});
