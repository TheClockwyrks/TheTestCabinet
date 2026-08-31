// Floe — controls/pause-escape: `Escape` pauses a live crossing.
//
// `specs/controls.md` binds `KeyP` and `Escape` to the `pause` action, reads pause
// as a press edge, and fixes what it does: "Open the pause menu from the `playing`
// screen". `specs/ui.md` states the same transition as `playing` + Pause moving
// the screen to `paused`.
//
// ONE BINDING OF ONE ACTION. `Escape` and `KeyP` are two keys bound to the same
// action and each carries its own point, so a build that wired one and left the
// other dead is graded differently from one that wired neither. The key is named
// literally rather than read off `BINDINGS`, because WHICH key is the whole of the
// point.
//
// `Escape` IS DELIBERATELY AMBIGUOUS, AND THAT IS THE POINT OF THIS ONE.
// `specs/controls.md` binds it to BOTH `pause` and `back`, and settles the
// ambiguity by screen: "On the `playing` screen it pauses; on every other screen
// it goes back." Under this engine both actions are registered against the same
// key, so a real `Escape` event raises both edges on the same frame and a live
// crossing must resolve it as the pause. Pressing the key rather than reaching for
// an action is what puts that ambiguity in front of the build.
//
// THE CROSSING IS LIVE AND EMPTY. `startCrossing` opens `playing`/`crossing` with
// the strait cleared of vehicles, floes and bears and the four world gates shut,
// so nothing on the strait can end the crossing under the check and the only thing
// that can move the screen is the key. The key is dispatched at the target the
// engine listens on, so the engine's binding of `Escape` to `pause`, its
// press-edge detection, and the build's reading of that action are every step
// between the key and the paused crossing; `specs/instrumentation.md` gives the
// surface no keyboard operation at all, so none of that path can be
// short-circuited.
//
// WHAT IS NOT GRADED HERE. Which items the pause menu shows is
// `screens.pause-menu`, that the strait freezes behind it is
// `screens.pause-freezes`, and that resuming returns the crossing as it stood is
// `screens.pause-resume`. This point asks only whether `Escape` moved the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The key this point decides, named literally: it is the whole of the point. */
const KEY = "Escape";

/**
 * Ticks recorded either side of the press, so the clip reads as a crossing that
 * was live and then was not.
 *
 * Neither is measured: the screen is read on the frame the press was delivered,
 * before the trailing stretch runs.
 */
const LIVE_TICKS = 24; // 0.2 s of a live crossing before the key goes down
const PAUSED_TICKS = 24; // 0.2 s of the paused screen after it comes up

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a live crossing to the paused screen when Escape is pressed", async () => {
  startCrossing(h);

  const live = h.snapshot();
  assertEqual(live.screen, "playing", "the pose opened a live crossing");
  assertEqual(live.phase, "crossing", "with the crossing running");

  const paused = await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    // One press edge, which is how specs/controls.md reads pause, so exactly one
    // transition can follow from it.
    await h.tap(KEY);
    const screen = h.snapshot().screen;
    await h.advance(PAUSED_TICKS);
    return screen;
  });

  assertEqual(
    paused,
    "paused",
    "Escape pauses a live crossing (specs/controls.md, specs/ui.md)",
  );
});
