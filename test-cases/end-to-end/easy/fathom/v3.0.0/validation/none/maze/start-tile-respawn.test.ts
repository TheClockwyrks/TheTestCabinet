// maze/start-tile-respawn — a lost life puts the forager back on the start tile.
//
// specs/progression.md has every attempt at a maze open from the tile that maze
// began on: "the forager returns to the maze's start tile".
//
// WHAT BREAKING IT COSTS is a player who has read the board being dropped
// somewhere they have not, which is a different fault from a start tile in the
// wrong rows. WHERE the start tile is allowed to sit is
// `maze.start-tile-in-range`.
//
// IT IS MEASURED ON A FEW FRESH BOARDS, because each costs a staged catch and
// the whole suite runs inside a budget. A build that respawns wrongly does so on
// the first board as readily as on the eighth.
//
// THE CATCH IS THE BUILD'S OWN CONTACT RULE. The roster's first hunter is placed
// on the forager's own tile and posed into `"chase"`, which is contact as
// specs/gameplay.md defines it, and the check then waits on the build to take the
// life. Every OTHER hunter is held where it stands first: a catch here is a
// contact rule rather than a chase, so no hunter needs to travel, and a den
// emptying behind the staged contact is a second body that could take the life
// somewhere else on the board.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { holdPredators } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type FathomSnapshot,
  type Harness,
} from "../harness";
import { tileKey } from "../maze";

/**
 * How many fresh boards the respawn half is measured on.
 *
 * Three, which is "several freshly laid out mazes" without spending a staged
 * catch on all eight: the rule is about where an attempt opens rather than about
 * a generator's spread, and a build that respawns wrongly does so on every board.
 */
const RESPAWN_BOARDS = 3;

/**
 * The ticks one staged catch is given before the check gives up on it.
 *
 * A predator whose center lies on the forager's own tile is in contact with it
 * (specs/gameplay.md), so a conforming build takes the life on the next tick. Two
 * seconds is a hard ceiling on that rather than an expectation.
 */
const CATCH_TICKS = 240;

/** Where the forager stands, as the tile key a failure names it by. */
function foragerTile(snapshot: FathomSnapshot): string {
  return tileKey({ tx: snapshot.forager.tx, ty: snapshot.forager.ty });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the forager back on the maze's start tile after a life is lost", async () => {
  for (let board = 1; board <= RESPAWN_BOARDS; board += 1) {
    const opened = await startPlaying(h);
    const start = foragerTile(opened);
    await holdPredators(h);
    await h.debug.setPredatorTile(0, opened.forager.tx, opened.forager.ty);
    await h.debug.setPredatorState(0, "chase");
    const taken = await h.until(
      (s) => s.lives < opened.lives || s.screen === "gameover",
      { maxTicks: CATCH_TICKS, poll: 2 },
    );
    if (board === 1) {
      // Before the assertions, so a failing check still leaves the board it read.
      await captureStill(h, "respawn");
    }
    assertEqual(
      taken.hit,
      true,
      `contact took a life on board ${board} the game laid out, which is ` +
        "what sets the next attempt up (specs/gameplay.md)",
    );
    assertEqual(
      foragerTile(taken.snapshot),
      start,
      `the tile the forager stands on for the next attempt at board ${board} ` +
        `the game laid out, which is that maze's own start tile ` +
        "(specs/progression.md)",
    );
  }
});
