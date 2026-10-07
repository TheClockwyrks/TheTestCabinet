// audio/mute-control-toggles — the status bar's mute control silences the audio.
//
// `specs/ui.md` puts a mute control on the status bar, and `specs/controls.md`
// has a contact pressed and released inside a status-bar control's region act
// that control "exactly as its keyboard route does". So the bar's control flips
// the same bit the `mute` action flips.
//
// THE KEY'S ROUTE IS ITS OWN POINT, `audio/mute-toggle`, so a build that binds
// the key and never wires the bar control grades differently from one that wires
// neither.
//
// WHERE THE BAR'S CONTROL IS. `specs/ui.md` hands the layout to the build, so the
// build reports it: `specs/instrumentation.md`'s `controlRect("mute", null)` is
// the region a contact drives the mute control from, and the press goes to the
// middle of the region the build named. Nothing here searches the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  standAtCamp,
  type Harness,
} from "../harness";
import { clickRegion, controlRegion } from "../panels/mouse";
import { armAudio } from "./probe";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips the mute bit from the region the status bar reports", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);

  const opened = (await h.snapshot()).muted;
  await clickRegion(h, await controlRegion(h, "mute"));
  const afterClick = (await h.snapshot()).muted;
  await captureStill(h, "bar");

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(opened, false, "specs/instrumentation.md");
  assertEqual(
    afterClick,
    true,
    "specs/ui.md: a press on the status bar's mute control toggles the audio",
  );
});
