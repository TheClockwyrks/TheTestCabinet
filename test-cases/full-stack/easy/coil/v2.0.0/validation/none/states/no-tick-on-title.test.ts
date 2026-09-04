// states/no-tick-on-title — the title screen advances nothing.
//
// specs/movement.md: "Ticks run only on the `playing` screen. A round that has
// ended, a paused game, and every menu screen leave the simulation where it
// stands." specs/ui.md adds the other half: "`simTime` accumulates the delta time
// of every update on the `playing` screen alone."
//
// Four seconds of game time is 32 ticks, so a build that ran even one in ten
// moved the chain off the cells it was posed on. The chain is posed mid-board
// rather than left at the starting cells, because a chain that moved and a chain
// that did not are otherwise a column apart on a board that is 28 wide.
//
// The title is where a build opens, so this is the screen a player sits on
// longest before touching anything, and a simulation running underneath it would
// have the round half over before it began.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureReplay,
  chainFrom,
  createHarness,
  poseScene,
  secondFrames,
  type Harness,
} from "../harness";

/** Seconds of game time the title is held for: 32 ticks' worth. */
const HELD_SECONDS = 4;

/** A chain mid-board, so a tick that ran would move it somewhere visible. */
const CHAIN = chainFrom(HOME_HEAD, "right", 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resolves no tick and accumulates no time on the title screen", async () => {
  const title = await poseScene(h, {
    screen: "title",
    snake: CHAIN,
    dir: "right",
    pellet: null,
  });
  assertEqual(title.screen, "title", "the screen the game is held on");
  assertEqual(title.ticks, 0, "the ticks resolved before the wait");

  const after = await captureReplay(h, "still", async () => {
    await h.advance(secondFrames(HELD_SECONDS));
    return h.snapshot();
  });

  assertEqual(after.ticks, 0, "the ticks resolved on the title screen");
  assertEqual(after.simTime, 0, "the simulation time the title accumulated");
  assertDeepEqual(after.snake, CHAIN, "the chain after the wait");
});
