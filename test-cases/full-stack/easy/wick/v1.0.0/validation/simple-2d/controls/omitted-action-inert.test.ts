// controls/omitted-action-inert — an action a screen omits does nothing there.
//
// WHAT THIS DECIDES. One thing: an action the screen table of
// specs/controls.md leaves out of a row is inert on that screen, read through
// two omissions the table makes: `pause` on `title` and `confirm` on `howto`.
// Every action a row DOES list is graded under its own screen point (the
// `screens/*-inert` points cover `back` on the title and the menu keys on the
// overlays); this point is the rule that an unlisted action changes neither
// the screen nor the highlight.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): "`title` | none | `up`,
//   `down` move the highlight, wrapping at both ends; `confirm` takes the
//   highlighted item; `mute`", which omits `pause`; "`howto` | none | `back`
//   returns to `title`; `mute`", which omits `confirm`. "An action a row omits
//   does nothing on that screen. `menuIndex` is `0` on entering every screen,
//   and on a screen with no highlight it stays `0`."
//   specs/controls.md ("Actions and bindings"): `pause` is `KeyP` and
//   `confirm` is `Enter`, `Space`.
//   specs/ui.md ("Menu navigation"): "`pause` is read on `playing` and
//   `paused` alone".
//
// THE DRIVE. The title through `reset` and the how-to screen through
// `poseScene("howto")`, which enters it "exactly as confirming `HOW TO PLAY`
// does" (specs/instrumentation.md) without pressing the title's confirm key,
// so a broken title menu fails its own points and not this one. On each, the
// screen and highlight are read back, one REAL press of the omitted action's
// key is dispatched for one frame, and both are read again. A build that
// paused the title, or confirmed a highlighted nothing on the how-to screen
// into a run, leaves a screen other than the one the frame began on.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
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
  assertEqual(title.menuIndex, 0, "the title highlight before KeyP");

  const afterPause = await tap(h, "KeyP");
  assertEqual(afterPause.screen, "title", "the screen KeyP left the game on");
  assertEqual(afterPause.menuIndex, 0, "the title highlight after KeyP");

  const howto = poseScene(h, "howto");
  assertEqual(howto.screen, "howto", "the screen Enter is pressed on");
  assertEqual(howto.menuIndex, 0, "the how-to highlight before Enter");

  const afterConfirm = await tap(h, "Enter");
  captureStill(h, "inert");

  assertEqual(
    afterConfirm.screen,
    "howto",
    "the screen Enter left the game on",
  );
  assertEqual(afterConfirm.menuIndex, 0, "the how-to highlight after Enter");
});
