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
// How long that span is, the specs leave to the build: specs/ui.md moves
// `in-mine` to `game-over` on "A death", and a build that shows the summary on
// the frame the hull reads empty is as conformant as one that plays the death
// out first. So the loop is not required to see the mine at all, and one more
// strike lands on the Game Over screen itself. specs/ui.md lists no transition
// out of `game-over` on `pause`, and specs/controls.md gives the action nothing
// there beyond "go back, where the screen has a back", which that menu has not.
// A build that answers the strike with the pause menu, or with the mine, has
// resumed play from a death.
//
// ISOLATION. An empty mine, a Standard expedition so nothing about the save is
// in play, and both faculties gated so the only thing acting is the hull check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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
 * Frames the recording holds either side of the death.
 *
 * The loop below leaves the bracket as soon as the Game Over screen arrives, which
 * is a handful of frames, so the expedition is left running at the camp before the
 * hull is emptied and the Game Over screen is left standing afterwards. That is
 * what a reviewer watches: play, the death, and the screen that refuses to resume.
 */
const RUN_UP_FRAMES = 20;
const SETTLE_FRAMES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("never reaches the pause menu once the death has been taken", async () => {
  await openAtCamp(h);
  pinMiner(h);
  pinDrill(h);

  const seen = await captureReplay(h, "over", async () => {
    // The expedition alive at the camp, so the clip has a before.
    await h.advance(RUN_UP_FRAMES);
    h.debug.setHull(0);
    await h.advance(1);

    const screens: Screen[] = [];
    for (let second = 0; second < DEATH_CEILING; second += 1) {
      if (h.snapshot().screen === "game-over") break;
      await h.tap(ACTION_KEY.pause);
      screens.push(h.snapshot().screen);
      await h.advanceSeconds(1, SECOND_FRAMES);
      screens.push(h.snapshot().screen);
    }
    const ended = h.snapshot();
    // Once more, on whatever screen the death reached.
    await h.tap(ACTION_KEY.pause);
    await h.advance(1);
    const struck: Screen[] = [h.snapshot().screen];
    // And the screen the death left, held long enough to read.
    await h.advance(SETTLE_FRAMES);
    struck.push(h.snapshot().screen);
    return { screens, ended, struck };
  });

  for (const screen of seen.screens) {
    assertEqual(
      screen === "paused",
      false,
      "specs/modes.md: play does not resume from a death",
    );
  }
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
  for (const screen of seen.struck) {
    assertEqual(
      screen === "paused" || screen === "in-mine",
      false,
      "specs/modes.md: play does not resume from a death, so the pause key on the Game Over screen reaches neither the pause menu nor the mine",
    );
  }
});
