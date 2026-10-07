// screens/chest-confirm-closes — `confirm` closes the chest overlay and the
// night resumes.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"): "`confirm` closes
// the overlay, sounding no cue: `screen = playing`, and the simulation resumes
// on the next tick." specs/progression.md ("The chest overlay"): "The
// simulation does not tick while the overlay is open; `confirm` closes it,
// setting `chestResult` to `null` and `screen` to `playing`."
// specs/controls.md fixes what the closing frame itself does: a frame's edges
// are read against the screen it began on and "The frame's update then runs on
// the screen the edges left: a frame whose press enters `playing`, from the
// title, an end screen, `paused`, or an overlay, runs that frame's ticks", so
// the frame that closes the overlay is itself a tick of the resumed run, and
// the next frame is another.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, so
// the chest falls through to the heal and nothing else on the frame can move,
// and the clock is read on either side of the press: while the overlay stood it
// did not move, and from the closing frame on it does. The press is a REAL
// `Enter` through Chromium's input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name, a null result and a tick count are exact
// comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  pressConfirm,
  type Harness,
} from "../harness";
import { night, openHealChest, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads playing with no chest result, and ticks again from the closing frame", async () => {
  await night(h);
  const opened = await openHealChest(h);
  const held = opened.run.tick;
  // A frame on the overlay ticks nothing: the clock the close is measured from.
  await shown(h);
  const standing = await h.snapshot();
  assertEqual(standing.run.tick, held, "the run clock while the overlay stood");

  const closed = await pressConfirm(h);
  await captureStill(h, "closed");
  const resumed = await h.step(1);

  assertEqual(closed.screen, "playing", "the screen Enter left");
  assertNull(closed.run.chestResult, "chestResult after the overlay closed");
  assertEqual(
    closed.run.tick,
    held + 1,
    "the run clock on the frame that closed the overlay",
  );
  assertEqual(
    resumed.run.tick,
    held + 2,
    "the run clock one frame after the overlay closed",
  );
});
