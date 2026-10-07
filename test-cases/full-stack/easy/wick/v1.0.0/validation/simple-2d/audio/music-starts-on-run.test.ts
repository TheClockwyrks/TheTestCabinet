// Wick — audio/music-starts-on-run: `music` is looping on the frame after a
// fresh run starts from the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused`. It starts on the
//     frame a fresh run starts".
//   - specs/ui.md (A fresh run): "`LIGHT THE LAMP` and `TRY AGAIN` each begin
//     a fresh run".
//   - specs/ui.md (Audio): "`api.audio.loop` starts a cue looping ... and
//     `api.audio.looping` reports whether it is; ... a cue is either looping or
//     not".
//   - specs/controls.md: a frame's press "enters `playing` ... runs that
//     frame's ticks", so the confirming frame is already a `playing` frame.
//
// WHAT IS READ. `looping("music")` off the engine's cue bus, one frame after
// the run started, with `screen` on `playing` as the evidence that a run
// really began.
//
// WHY THE RUN IS STARTED AS IT IS. The one point in this category that presses
// the menu, because the requirement names the fresh run started "from the
// title": the game is reset to the title and `confirm` takes `LIGHT THE LAMP`
// at `menuIndex` `0`, the real route. One more frame is run before the reading,
// which is the frame the review item names, so a build that starts the loop
// from its next frame's reconciliation rather than inside the confirming frame
// passes; that spare frame is the whole of the tolerance.
//
// TOLERANCE. The one spare frame above. None on the reading itself, which is a
// boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music looping on the frame after LIGHT THE LAMP starts the run", async () => {
  const after = await captureReplay(h, "started", async () => {
    await startPlay(h);
    return h.tick(1);
  });

  assertEqual(after.screen, "playing", "the screen after the run started");
  assertEqual(
    h.looping("music"),
    true,
    "music looping on the frame after the run started",
  );
});
