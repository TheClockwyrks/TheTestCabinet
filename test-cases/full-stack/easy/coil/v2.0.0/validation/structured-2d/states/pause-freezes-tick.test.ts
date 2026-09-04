// states/pause-freezes-tick — nothing advances while the game is paused.
//
// specs/ui.md, on `paused`: "the round is frozen behind it: no tick runs while
// the game is paused, so the snake is exactly where it stood and the combo window
// is exactly as full when the game resumes." specs/movement.md says the same from
// the other side: "Ticks run only on the `playing` screen."
//
// The span is deliberately longer than anything the round holds: eight seconds of
// game time is 64 ticks and more than twice `COMBO_WINDOW`, so a build that ran
// even one tick in ten moved the chain, and a build that drained the window at
// all lapsed it. The window is posed full and the chain posed mid-board, because
// a frozen zero and a frozen starting chain are indistinguishable from a build
// that reset them.
//
// The pause is reached through the surface: whether `back` PAUSES is
// `states/pause-reachable`, and this decides only what a pause holds still.

import { afterEach, beforeEach, it } from "vitest";
import { COMBO_WINDOW } from "../../src/constants";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureReplay,
  chainFrom,
  createHarness,
  poseScene,
  secondFrames,
  type Harness,
} from "../harness";

/** Seconds of game time the pause is held for: 64 ticks, and 2.3 windows. */
const HELD_SECONDS = 8;

/** A chain mid-board, so a tick that ran would move it somewhere visible. */
const CHAIN = chainFrom(HOME_HEAD, "right", 5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resolves no tick however much game time passes on the pause screen", async () => {
  const paused = poseScene(h, {
    screen: "paused",
    snake: CHAIN,
    dir: "right",
    pellet: null,
    combo: 3,
    comboWindow: COMBO_WINDOW,
  });
  assertEqual(paused.screen, "paused", "the screen the game is held on");

  const after = await captureReplay(h, "frozen", async () => {
    await h.advance(secondFrames(HELD_SECONDS));
    return h.snapshot();
  });

  assertEqual(after.ticks, paused.ticks, "the ticks resolved while paused");
  assertDeepEqual(after.snake, CHAIN, "the chain after the pause");
  assertCloseTo(
    after.comboWindow,
    COMBO_WINDOW,
    9,
    "the seconds left on the combo window after the pause",
  );
  assertEqual(after.combo, 3, "the multiplier after the pause");
});
