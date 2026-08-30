// controls/key-pause — `Space` toggles the in-place pause.
//
// THE REQUIREMENT. `specs/controls.md` binds `pause` to `Space`: "Toggles the
// in-place pause", and describes it as freezing the simulation "without opening a
// menu". `specs/ui.md` is explicit that the screen does not change under it — the
// game "can be paused in place here", on `playing`, with the yard still visible
// and no menu over it — and `specs/instrumentation.md` reports the pause as
// `paused` with the screen staying `playing`.
//
// HOW IT IS DECIDED. A wave is opened with one held unit on the yard, so what the
// pause is engaged over is a run with something in it rather than an idle build
// phase. `Space` is pressed as a player presses it, a real browser key event
// through the build's own keyboard layer, and `paused` and `screen` are read; it
// is pressed a second time and both are read again. The screen has to read
// `playing` at every one of those reads, because a build that answers the pause
// key by opening the pause MENU has implemented the wrong control.
//
// WHAT THIS POINT IS NOT. That the pause really freezes the yard is the screens
// checklist's `inplace-pause`. This point decides the key toggling the bit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("engages the in-place pause and releases it again on Space", async () => {
  await openYard(h, { wave: 4 });
  // Travel held, so the unit cannot leak the run out from under the check while
  // the pause is being toggled over it.
  await releaseUnit(h, "mote", { frozen: true });

  const before = await h.snapshot();
  assertEqual(
    before.paused,
    false,
    "the in-place pause released before the key is touched " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    before.screen,
    "playing",
    "the screen a wave runs on (specs/ui.md)",
  );

  await h.tap(keyFor("pause"));
  await captureStill(h, "pause");

  const engaged = await h.snapshot();
  assertEqual(
    engaged.paused,
    true,
    `pressing ${keyFor("pause")} on playing to engage the in-place pause ` +
      "(specs/controls.md)",
  );
  assertEqual(
    engaged.screen,
    "playing",
    "the screen under an in-place pause, which opens no menu (specs/ui.md)",
  );

  await h.tap(keyFor("pause"));

  const released = await h.snapshot();
  assertEqual(
    released.paused,
    false,
    `pressing ${keyFor("pause")} a second time to release the in-place pause ` +
      "(specs/controls.md)",
  );
  assertEqual(
    released.screen,
    "playing",
    "the screen after the pause is released (specs/ui.md)",
  );
});
