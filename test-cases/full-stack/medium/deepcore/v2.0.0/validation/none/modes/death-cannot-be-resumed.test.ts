// modes/death-cannot-be-resumed — nothing puts the mine back after a death.
//
// specs/modes.md: "A death takes effect the moment its cause holds and cannot be
// undone. Play does not resume from it." specs/controls.md binds `pause` in the
// mine to "Open the pause menu", and the pause menu is a way back to live play —
// it offers RESUME. So once a death has been taken, `pause` must not reach that
// menu, however long the build plays the death out before showing the summary.
//
// The key is struck through the engine's own input, repeatedly, from the frame
// after the cause holds until the expedition has ended, and the screen is read
// after every strike. `paused` is never one of the answers, and the expedition
// ends at the Game Over screen.
//
// Striking stops once the summary is up, because specs/ui.md gives `pause` a
// meaning on the Game Over screen of its own — leaving it — and this check is
// about the span between the death and that screen.
//
// ISOLATION. An empty mine, a Standard expedition so nothing about the save is
// in play, and both faculties gated so the only thing acting is the hull check.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  pinDrill,
  pinMiner,
  type Harness,
  type Screen,
} from "../harness";
import { openAtCamp } from "../save/expedition";

/** Seconds of game time the death is given, and the frames each second runs in. */
const DEATH_CEILING = 8;
const SECOND_FRAMES = 8;

/**
 * The frames the replay is padded with, so the refused pause is something a
 * reviewer can WATCH.
 *
 * Each pass of the loop is one tap and eight frames, and the loop stops the
 * moment the Game Over screen arrives, so the recording was a sixth of a second.
 * The recorder is armed on the living miner for `RUN_UP` and held on the screen
 * the death reached for `SETTLE`. Neither changes what is read: the screens are
 * sampled where they were before, and the miner's body and drill are both gated.
 */
const RUN_UP = 24;
const SETTLE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never reaches the pause menu once the death has been taken", async () => {
  await openAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);

  const seen = await captureReplay(h, "over", async () => {
    await h.advance(RUN_UP);
    await h.debug.setHull(0);
    await h.advance(1);

    const screens: Screen[] = [];
    for (let second = 0; second < DEATH_CEILING; second += 1) {
      if ((await h.snapshot()).screen === "game-over") break;
      await h.tap(ACTION_KEY.pause);
      screens.push((await h.snapshot()).screen);
      await h.advanceSeconds(1, SECOND_FRAMES);
      screens.push((await h.snapshot()).screen);
    }
    const ended = await h.snapshot();
    await h.advance(SETTLE);
    return { screens, ended };
  });

  for (const screen of seen.screens) {
    assertEqual(
      screen === "paused",
      false,
      "specs/modes.md: play does not resume from a death",
    );
  }
  assertContains(
    seen.screens,
    "in-mine",
    "the key was struck while the death was still playing out",
  );
  assertEqual(
    seen.ended.screen,
    "game-over",
    "specs/modes.md: a death ends the expedition at the Game Over screen",
  );
  assertEqual(
    seen.ended.summary?.deathCause,
    "hull-destroyed",
    "specs/modes.md: an empty hull is what ended it",
  );
});
