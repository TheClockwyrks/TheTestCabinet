// Floe — controls/pause-escape: `Escape` pauses a live crossing.
//
// `specs/controls.md` binds `KeyP` and `Escape` to Pause, reads Pause as a press
// edge, and fixes what it does: "Open the pause menu from the `playing`
// screen". `specs/ui.md` states the same transition as `playing` + Pause moving
// the screen to `paused`.
//
// `Escape` IS DELIBERATELY AMBIGUOUS, AND THAT IS THE POINT OF THIS ONE.
// `specs/controls.md` binds it to BOTH Pause and Back, and settles the ambiguity
// by screen: "On the `playing` screen it pauses; on every other screen it goes
// back." A real `Escape` key event therefore raises both edges at once, and a
// live crossing must resolve it as the pause. Pressing the key rather than
// reaching for an action is what puts that ambiguity in front of the build.
//
// ONE BINDING OF ONE ACTION. `KeyP` and `Escape` are two keys bound to the same
// action and each carries its own point, so a build that wired one and left the
// other dead is graded differently from one that wired neither.
//
// THE CROSSING IS LIVE AND EMPTY. `startCrossing` opens `playing`/`crossing` with
// the strait cleared of vehicles, floes and bears and the four world gates shut,
// so nothing on the strait can end the crossing under the check and the only
// thing that can move the screen is the key. The key is pressed through
// Chromium's own input pipeline, so what reaches the build is a browser-trusted
// DOM key event on the real page; under this engine the whole keyboard layer is
// the build's own (`specs/instrumentation.md` gives the surface no keyboard
// operation at all), so the path from a physical key to a paused crossing
// belongs entirely to the build.
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

/**
 * Ticks recorded either side of the press, so the clip reads as a crossing that
 * was live and then was not.
 *
 * Neither is measured: the screen is read on the tick the press was delivered,
 * before the trailing stretch runs.
 */
const LIVE_TICKS = 24; // 0.2 s of a live crossing before the key goes down
const PAUSED_TICKS = 24; // 0.2 s of the paused screen after it comes up

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a live crossing to the paused screen when Escape is pressed", async () => {
  await startCrossing(h);

  const live = await h.snapshot();
  assertEqual(live.screen, "playing", "the pose opened a live crossing");
  assertEqual(live.phase, "crossing", "with the crossing running");

  const paused = await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    // Down, one tick, up: a press edge a build can see however it reads its
    // keyboard.
    await h.tap("Escape");
    const screen = (await h.snapshot()).screen;
    await h.advance(PAUSED_TICKS);
    return screen;
  });

  assertEqual(
    paused,
    "paused",
    "Escape pauses a live crossing (specs/controls.md, specs/ui.md)",
  );
});
