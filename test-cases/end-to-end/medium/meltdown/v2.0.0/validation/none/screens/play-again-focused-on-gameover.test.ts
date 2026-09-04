// Meltdown — screens/play-again-focused-on-gameover: PLAY AGAIN is focused the
// moment the gameover screen opens.
//
// THE RULE. `specs/screens.md`'s "What is highlighted on arrival": arriving at
// `gameover` from `playing` highlights `PLAY AGAIN`, row `0`.
// `specs/instrumentation.md` reports the highlighted row as `menuIndex`.
//
// ONE SCREEN, BECAUSE THE TWO ARE TWO TRANSITIONS. `specs/waves.md` wins a run by
// clearing its final wave with a life in hand and loses it the frame the lives
// reach `0`, so the two end screens open down separate paths and a build that
// puts the highlight back on one path and not the other must not grade as one
// that does neither. The other screen is `screens.play-again-focused-on-victory`'s.
//
// WHY THE SCREEN IS REACHED AND NOT POSED. This is an ENTRY EFFECT: the claim is
// about what the screen holds THE MOMENT IT OPENS. `setScreen` "sets that field
// alone and runs no entry effect", and explicitly resets no menu index
// (`specs/instrumentation.md`) — so a posed end screen could never show this, and
// a build that focuses the right row would fail while a build that focuses none
// would pass. The transition is therefore driven through the game's own rules.
//
// THE HIGHLIGHT IS PUT SOMEWHERE ELSE FIRST, on the end menu's last row, so that
// reading `0` afterwards can only have come from the transition. A build that
// carries the highlight through reads that row, a build that clamps it into range
// reads that row too, and only a build that puts the highlight back on
// `PLAY AGAIN` reads `0`.
//
// WHY IT MATTERS ENOUGH TO CARRY AN ITEM. `PLAY AGAIN` is the first row, and a
// build that leaves the highlight where the run's last menu left it opens the end
// screen with `MENU` under the confirm — so a player pressing confirm to play
// again is thrown back to the title instead.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the transition happens at all is
// `waves.game-over-at-zero-lives`'s reading, and what the screen DRAWS is
// `screens.gameover-screen`'s. This one reads the highlight the screen opens on.
//
// HOW THIS END IS REACHED, AND WHY IT IS THE CHEAPEST HONEST ROUTE.
//
//   ON SUDDEN DEATH. `specs/modes.md` puts one life on that row and
//   `specs/surge.md` costs a Mote's leak one life, so the single cheapest leak in
//   the game takes the lives to `0`, which `specs/waves.md` says "ends the run at
//   once ... and opens the game-over screen". One Mote is posed two tiles short of
//   its exhaust and walks out under its own power.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COLS, ENDING_ITEMS, tileCX, tileCY } from "../constants";
import { LEFT_LANE_ROW } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/** Where PLAY AGAIN sits on both end screens (`specs/screens.md`). */
const PLAY_AGAIN_ROW = 0;

/**
 * Where the highlight is put before the transition.
 *
 * Any row but the one expected, so a build that left the index where it stood
 * reads `1`. `ENDING_ITEMS` has two rows, so this is the only other one.
 */
const STALE_ROW = ENDING_ITEMS.length - 1;

/** The mode this end is reached on. */
const MODE = "suddendeath" as const;

/**
 * Where the last unit is posed: two tiles short of the right exhaust, on the left
 * corridor's own row.
 *
 * Geometry, not a tolerance. Far enough that the unit is genuinely on the floor and
 * walking when the drive begins, near enough that it arrives in a fraction of a
 * second of game time.
 */
const LEAK_TILE = { col: COLS - 3, row: LEFT_LANE_ROW };

/**
 * How long the Mote is given to cover those two tiles.
 *
 * It covers `60` logical units a second (`specs/surge.md`) and two tiles is `38`,
 * so it arrives in under two thirds of a second. A ceiling on a hung build rather
 * than a bound on anything asserted, which is why it is loose.
 */
const LEAK_WINDOW = 2.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the gameover screen with the highlight on PLAY AGAIN", async () => {
  const { debug } = h;

  // The last unit of a wave with nothing left to release, walking out.
  await startRun(h, MODE);
  await debug.setPhase("wave");
  await debug.setBuildTimer(0);
  await debug.setWavePending(0);
  const mote = await poseWalker(h, "mote", "left");
  await debug.setUnitPosition(
    mote,
    tileCX(LEAK_TILE.col),
    tileCY(LEAK_TILE.row),
  );
  await debug.setMenuIndex(STALE_ROW);

  const posed = await h.snapshot();
  const where = `gameover, reached on ${MODE} with the highlight left on row ${posed.menuIndex}`;

  const ended = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: framesFor(LEAK_WINDOW),
  });
  await captureStill(h, "focused");

  assertEqual(ended.hit, true, `the Mote reached its exhaust, for ${where}`);
  assertEqual(
    ended.snapshot.screen,
    "gameover",
    `the screen the last unit going opened, for ${where}`,
  );
  assertEqual(
    ended.snapshot.menuIndex,
    PLAY_AGAIN_ROW,
    `the highlighted row gameover opened on, which ${ENDING_ITEMS[PLAY_AGAIN_ROW]} sits at (${where})`,
  );
});
