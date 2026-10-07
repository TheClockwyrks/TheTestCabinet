// modes/hardcore-death-deletes-the-save-at-once — the mode's cost is charged at
// the death, not at the screen it leads to.
//
// specs/modes.md: "A death takes effect the moment its cause holds and cannot be
// undone. Play does not resume from it, and the mode's consequence below is
// applied then rather than when the Game Over screen arrives, so nothing done
// after the death changes what it costs." For Hardcore that consequence is the
// one the mode is named for: "The save is deleted, so a save banked at the pad
// does not survive the death."
//
// So this reads the slot on the frame the death lands rather than on the screen
// it ends at. A build that plays a death out before charging for it leaves a
// window in which the expedition is over and the save is still there, and the
// specification closes that window.
//
// WHAT IS AND IS NOT ASSERTED ABOUT TIMING. How long a build plays a death out
// is its own; that a Hardcore save is gone the moment the hull stands at `0` is
// not. The reading is taken a couple of frames after the cause holds, and the
// screen is deliberately not asserted at that instant, so a build that shows the
// summary immediately and a build that plays an animation first both pass.
//
// ISOLATION. One Hardcore expedition on an empty mine with the slot cleared
// first, so the save that goes is the one this check banked, and both faculties
// gated so nothing but the hull check acts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { bankSave, openAtCamp, waitForGameOver } from "../save/expedition";

/**
 * Frames between the hull standing at `0` and the reading.
 *
 * Two rather than one, so a build that resolves the check at a different point
 * in its own frame is not held to an ordering the specification leaves open.
 */
const AT_ONCE_FRAMES = 2;

/**
 * The frames the replay is padded with, so the death is something a reviewer can
 * WATCH.
 *
 * The reading itself is two frames and the sweep to the Game Over screen is a
 * few more, which is a sixth of a second at the rate this suite steps. The
 * recorder is armed on the living miner for `RUN_UP` and held on the Game Over
 * screen for `SETTLE`, so the section shows the expedition alive, the hull
 * emptying, and what it left behind. Neither touches what is read: `struck` is
 * taken at `AT_ONCE_FRAMES` exactly, which is the point the requirement is about,
 * and the miner's body and drill are both gated.
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

it("deletes the save on the frame the Hardcore death lands", async () => {
  await openAtCamp(h, { mode: "hardcore" });
  await bankSave(h);
  await pinMiner(h);
  await pinDrill(h);
  const banked = await h.snapshot();

  const run = await captureReplay(h, "gone", async () => {
    await h.advance(RUN_UP);
    await h.debug.setHull(0);
    await h.advance(AT_ONCE_FRAMES);
    const struck = await h.snapshot();
    const over = await waitForGameOver(h);
    await h.advance(SETTLE);
    return { struck, over };
  });

  assertEqual(banked.hasSave, true, "the save this check deletes was banked");
  assertEqual(
    run.struck.hasSave,
    false,
    "specs/modes.md: the Hardcore consequence is applied at the death itself",
  );
  assertEqual(run.over.mode, "hardcore", "the expedition died in Hardcore");
  assertEqual(
    run.over.summary?.deathCause,
    "hull-destroyed",
    "specs/modes.md: an empty hull is what ended it",
  );
  assertEqual(
    run.over.hasSave,
    false,
    "specs/modes.md: and the save is still gone at the Game Over screen",
  );
});
