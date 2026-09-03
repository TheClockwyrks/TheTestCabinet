// controls/omitted-action-inert — an action a screen omits does nothing there.
//
// WHAT THIS DECIDES. One thing: a screen reads only the actions its row of the
// screen table lists. `pause` on `title` and `confirm` on `howto`, neither of
// which its row names, leave the screen and `menuIndex` exactly as they were.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): "An action a row omits does
//   nothing on that screen." The `title` row reads "`up`, `down` ...; `confirm`
//   ...; `mute`", with no `pause`; the `howto` row reads "`back` returns to
//   `title`; `mute`", with no `confirm`.
//   specs/controls.md ("Actions and bindings"): "`pause` | `KeyP` | edge |
//   pauses on `playing`; resumes on `paused`", and "`confirm` | `Enter`,
//   `Space` | edge | accepts the highlighted item; closes the chest overlay".
//   specs/ui.md ("`howto`"): "`back` returns to `title` with `menuIndex = 0`",
//   and nothing else is read there.
//
// THE DRIVE. `KeyP` on the `title` the harness's opening `reset` left, then
// `howto` posed straight through the surface — the route that touches no menu
// — and `Enter` there. Each is a REAL key through Chromium's input pipeline
// held across one frame, and each screen and index is read before its press so
// that the comparison is against the state the press found.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  pressConfirm,
  pressPause,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves title untouched by KeyP and howto untouched by Enter", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen KeyP is pressed on");
  const afterPause = await pressPause(h);

  const howto = await poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen Enter is pressed on");
  const afterConfirm = await pressConfirm(h);
  await captureStill(h, "inert");

  assertEqual(afterPause.screen, "title", "the screen after KeyP on title");
  assertEqual(
    afterPause.menuIndex,
    title.menuIndex,
    "menuIndex after KeyP on title",
  );
  assertEqual(afterConfirm.screen, "howto", "the screen after Enter on howto");
  assertEqual(
    afterConfirm.menuIndex,
    howto.menuIndex,
    "menuIndex after Enter on howto",
  );
});
