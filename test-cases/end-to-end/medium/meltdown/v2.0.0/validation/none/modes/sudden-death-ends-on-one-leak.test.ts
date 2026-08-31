// modes/sudden-death-ends-on-one-leak — one leak ends a Sudden Death run.
//
// THE RULE. `specs/modes.md`: "Sudden Death opens on `1` life, so a single leak of
// any unit takes the lives to `0` and ends the run." `specs/waves.md` gives the
// general form: "Lives reaching `0` ends the run at once, on the frame it happens
// and whatever the phase, and opens the game-over screen."
//
// HOW THE LEAK IS REACHED. Through the game's own path, because the leak IS the
// requirement: one Mote is posed two tiles short of its exhaust, walking under its
// own power, and the drive is left to carry it out. `specs/surge.md` costs a Mote's
// leak one life, and `specs/modes.md` puts exactly one life on the row, so the
// single cheapest leak in the game is enough — which is the whole point of the
// mode.
//
// THE LIFE IS THE ROW'S OWN FIGURE, computed from `specs/modes.md`'s table by the
// harness rather than read back off the build. So this item does not lean on the
// build having derived `startLives` correctly — that is
// `modes.sudden-death-one-life`'s reading — and a build with both right and a
// build with only this one right grade differently.
//
// WHAT IS READ. The lives at `0` and the game-over screen, which are the two
// halves of "ends the run". A build that let the run continue reads `playing` with
// a life still standing; a build that ended the run in VICTORY instead reads
// `victory`, which is the wrong end of a wave that had nothing left to release.
// The score and the wave the game-over screen reports are
// `screens.gameover-reports-the-run`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COLS, SUDDEN_DEATH_LIVES, tileCX, tileCY } from "../constants";
import { LEFT_LANE_ROW } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/**
 * Where the Mote is posed: two tiles short of the right exhaust, on the left
 * corridor's own row.
 *
 * Geometry, not a tolerance. Far enough that the unit is genuinely on the floor
 * and walking when the drive begins, near enough that the leak costs a fraction of
 * a second of game time.
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
  await h.dispose();
});

it("takes the lives to 0 and opens the game-over screen on one leak", async () => {
  const { debug } = h;
  // Sudden Death, mid-wave with nothing left to release, on the one life its row
  // gives it.
  await startRun(h, "suddendeath");
  await debug.setPhase("wave");
  await debug.setBuildTimer(0);
  await debug.setWavePending(0);
  const mote = await poseWalker(h, "mote", "left");
  await debug.setUnitPosition(mote, tileCX(LEAK_TILE.col), tileCY(LEAK_TILE.row));

  const posed = await h.snapshot();
  assertEqual(
    posed.lives,
    SUDDEN_DEATH_LIVES,
    "the life the run carried into the leak",
  );

  const ended = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: framesFor(LEAK_WINDOW),
  });
  await captureStill(h, "gameover");

  assertEqual(ended.hit, true, "the Mote reached its exhaust");
  assertEqual(ended.snapshot.lives, 0, "the lives after the one leak");
  assertEqual(
    ended.snapshot.screen,
    "gameover",
    "the screen the leak opened",
  );
});
