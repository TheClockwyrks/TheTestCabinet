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
 * Frames the recording holds either side of the death.
 *
 * The reading itself takes two frames and the Game Over screen arrives a moment
 * later, so the bare bracket is a flicker. The expedition is left running at the
 * camp before the hull is emptied and the summary is left on screen afterwards,
 * which is what a reviewer watches this clip for.
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

it("deletes the save on the frame the Hardcore death lands", async () => {
  await openAtCamp(h, { mode: "hardcore" });
  bankSave(h);
  pinMiner(h);
  pinDrill(h);
  const banked = h.snapshot();

  const run = await captureReplay(h, "gone", async () => {
    // The expedition alive at the camp, so the clip has a before.
    await h.advance(RUN_UP_FRAMES);
    h.debug.setHull(0);
    await h.advance(AT_ONCE_FRAMES);
    const struck = h.snapshot();
    const over = await waitForGameOver(h);
    // And the Game Over screen left standing, which is what it left behind.
    await h.advance(SETTLE_FRAMES);
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
