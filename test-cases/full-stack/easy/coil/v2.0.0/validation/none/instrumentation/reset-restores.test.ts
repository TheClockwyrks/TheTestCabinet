// instrumentation/reset-restores — `reset()` puts every field the snapshot
// reports back to the value a freshly started session opens on.
//
// WHY IT IS ITS OWN POINT. Every posed scene in this project opens with a reset,
// so a reset that leaves anything behind does not fail loudly: it quietly leaks
// one section's score, chain or spent combo window into the next, and the point
// that then fails is whichever one happened to run after. This check poses a
// game disturbed in every field an operation can reach, resets it, and reads the
// whole snapshot back at once.
//
// WHAT THE OPENING STATE IS. specs/instrumentation.md lists it: the title screen
// with `menuIndex` at 0, the score and the best score at 0, the multiplier at 1
// with its window closed, `ticks` and `simTime` at 0, the starting chain of
// specs/board.md facing right, an empty turn buffer, no live pellet, the mode's
// own obstacle course back on the board, and all three driver switches on. Under
// this engine a reset also re-arms manual stepping, so `autoStep` reads false.
//
// `muted` is deliberately NOT asserted: the same file holds it untouched by a
// reset, because muting is a player preference rather than a value a round opens
// with.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  COMBO_WINDOW,
  OBSTACLE_CELLS,
  START_CELLS,
  START_DIR,
  type Cell,
} from "../constants";
import {
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** Ticks run before the reset, so `ticks` and `simTime` have somewhere to fall from. */
const DISTURB_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A stable order two lists of cells can be compared in. */
function byCell(a: Cell, b: Cell): number {
  return a.row - b.row || a.col - b.col;
}

it("restores every field the snapshot reports to its opening value", async () => {
  // A thoroughly disturbed game: the chain moved and turned, a score and a best,
  // a live combo at a raised multiplier, a pellet somewhere it was put, every
  // switch off, and a screen that is not the title.
  const disturbed = await poseScene(h, {
    snake: chainFrom({ col: 20, row: 10 }, "up", 6),
    dir: "up",
    pellet: { col: 4, row: 3 },
    score: 480,
    best: 1230,
    combo: 4,
    comboWindow: COMBO_WINDOW,
    steering: false,
    travel: false,
    pelletRespawn: false,
    screen: "playing",
  });
  await h.tick(DISTURB_TICKS);
  const before = await h.snapshot();
  assertEqual(before.ticks, DISTURB_TICKS, "the ticks a reset has to clear");
  assertEqual(before.screen, "playing", "the screen a reset has to leave");
  assertEqual(disturbed.score, 480, "the score a reset has to clear");

  await h.debug.reset();
  const after = await h.snapshot();

  // The picture the reset left, taken before the readings are judged, so a check
  // that fails still leaves the frame that shows why.
  await h.advance(1);
  await captureStill(h, "reset");

  assertEqual(after.screen, "title", "screen");
  assertEqual(after.menuIndex, 0, "menuIndex");
  assertEqual(after.score, 0, "score");
  assertEqual(after.best, 0, "best");
  assertEqual(after.combo, 1, "combo");
  assertEqual(after.comboWindow, 0, "comboWindow");
  assertEqual(after.ticks, 0, "ticks");
  assertCloseTo(after.simTime, 0, 9, "simTime");
  assertDeepEqual(after.snake, [...START_CELLS], "the starting chain");
  assertLength(after.snake, START_CELLS.length, "the starting chain");
  assertEqual(after.dir, START_DIR, "dir");
  assertDeepEqual(after.turns, [], "turns");
  assertNull(after.pellet, "pellet");
  assertEqual(after.steering, true, "steering");
  assertEqual(after.travel, true, "travel");
  assertEqual(after.pelletRespawn, true, "pelletRespawn");
  assertEqual(after.autoStep, false, "autoStep");

  // The obstacle course the mode lays is back on the board, whichever mode this
  // build ships. specs/mode.md fixes it per mode and the snapshot names which.
  assertDeepEqual(
    [...after.obstacles].sort(byCell),
    [...OBSTACLE_CELLS[after.mode]].sort(byCell),
    `the ${after.mode} mode's obstacle course`,
  );
});
