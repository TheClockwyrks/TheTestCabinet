// states/pause-reachable — a live round pauses, with the board still behind the
// menu.
//
// specs/controls.md has `back` pause a live round, and specs/ui.md has `paused`
// "reached from `playing`", with "The board is visible behind the pause menu."
// Both halves are read here: the screen the game moves to, and that the round is
// still drawn under it — a build that pauses by tearing the board down leaves the
// player nothing to come back to, and fails on the second reading.
//
// The board behind the menu is read as the sprite painted on the head's own cell.
// specs/assets.md has the snake drawn from produced sprites, so a cell of the
// chain that is still on screen is a cell something blitted onto; where the menu
// sits over it, and what it looks like, are the build's.
//
// The round is reached through the surface rather than through the title menu,
// and the chain is posed clear of the board's furniture, so what this decides is
// the pause and nothing on the way to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { KEY } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  spriteOnCell,
  type Harness,
} from "../harness";

/** A chain long enough to read as a round in progress. */
const CHAIN = chainFrom(HOME_HEAD, "right", 6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a live round to paused and keeps the board behind it", async () => {
  const live = await poseScene(h, {
    snake: CHAIN,
    dir: "right",
    pellet: null,
    travel: false,
  });
  assertEqual(live.screen, "playing", "the screen back is pressed on");

  await h.tap(KEY.back);
  const blits = await h.frameBlits();
  await captureStill(h, "paused");

  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen back opened from playing");
  assertDeepEqual(paused.snake, CHAIN, "the chain the pause froze");
  assertNotNull(
    spriteOnCell(h, blits, HOME_HEAD.col, HOME_HEAD.row),
    "the board still drawn behind the pause menu",
  );
});
