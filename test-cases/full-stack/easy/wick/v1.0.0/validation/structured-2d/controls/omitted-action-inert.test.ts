// controls/omitted-action-inert — an action a screen omits does nothing
// there.
//
// WHAT THIS DECIDES. One thing: a press of an action the screen table leaves
// out of a screen's row leaves that screen exactly as it was, both the screen
// and `menuIndex`. Two rows are read: `pause` on `title`, whose row lists no
// `pause`, and `confirm` on `howto`, whose row lists no `confirm`. That the
// listed actions DO act is every other point's business.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): "`title` | none | `up`,
//   `down` move the highlight, wrapping at both ends; `confirm` takes the
//   highlighted item; `mute`", "`howto` | none | `back` returns to `title`;
//   `mute`", and "An action a row omits does nothing on that screen.
//   `menuIndex` is `0` on entering every screen, and on a screen with no
//   highlight it stays `0`."
//   specs/controls.md ("Actions and bindings"): "`pause` | `KeyP` | edge |
//   pauses on `playing`; resumes on `paused`".
//   specs/ui.md ("Menu navigation"): "`pause` is read on `playing` and
//   `paused` alone".
//
// THE DRIVE. `reset` puts the game on the title with `menuIndex` `0`; a REAL
// `KeyP` is dispatched at the engine's input seam and delivered by one frame,
// and the screen and index are read back. The how-to screen is then posed
// through the surface, which enters it by setting `screen` with `menuIndex` `0`
// and the run left as it stands, so no title key is on the path; a REAL `Enter`
// is delivered by one frame there and the screen and index read back again. A
// build that paused from the title, or that took `confirm` on `howto` as a menu
// confirm and left the screen, reads another screen on the line that names it.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves title untouched by KeyP and howto untouched by Enter", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen KeyP is pressed on");
  assertEqual(title.menuIndex, 0, "menuIndex before KeyP on the title");

  const afterPause = await tap(h, "KeyP");

  const howto = poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen Enter is pressed on");
  assertEqual(howto.menuIndex, 0, "menuIndex before Enter on howto");

  const afterConfirm = await tap(h, "Enter");
  captureStill(h, "inert");

  assertEqual(afterPause.screen, "title", "the screen after KeyP on the title");
  assertEqual(afterPause.menuIndex, 0, "menuIndex after KeyP on the title");
  assertEqual(afterConfirm.screen, "howto", "the screen after Enter on howto");
  assertEqual(afterConfirm.menuIndex, 0, "menuIndex after Enter on howto");
});
