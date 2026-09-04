// screens/hud-sound-toggles — the HUD's `SOUND` control flips the mute bit, and
// flips it back.
//
// `specs/screens.md`, the HUD's table: "`SOUND` | `HUD_ITEMS[2]` | `HUD_SOUND` |
// Toggles muting, as `specs/audio.md` states." `specs/audio.md`: "the HUD's
// `SOUND` control toggles it". `specs/instrumentation.md` fixes where the answer
// is read: `muted`, "the game's copy of the runtime's mute bit, refreshed in
// every update", and it is emphatic that "There is therefore no operation that
// sets muting: mute is reached the way a player reaches it, through the HUD's
// `SOUND` control, and the snapshot reports the result." So this control is the
// only way in, and this reading is the only way out.
//
// BOTH PRESSES BELONG TO ONE ITEM, because a toggle is one requirement: a control
// that only ever turns mute ON is not a toggle, and the second press is what
// separates it from one that is. Neither press asserts a LITERAL value —
// `specs/instrumentation.md` has `reset` leave `muted` "exactly as it stands,
// because muting is a player preference the runtime owns", so the check reads the
// bit the build starts with and requires the opposite of THAT, then the original
// again.
//
// WHETHER MUTING ACTUALLY SILENCES anything is `audio/mute-silences` and
// `audio/unmute-restores`. This item decides the control alone, which is why no
// sound is armed or watched here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_SOUND } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  openTable,
  rectCenter,
  type Harness,
} from "../harness";

/** The point pressed and released: the centre of the control's own rectangle. */
const PRESS = rectCenter(HUD_SOUND);

/** One frame, so the canvas carries the HUD the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips muted on a press and back on the next", async () => {
  await openTable(h);
  const before = (await h.snapshot()).muted;

  await clickAt(h, PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  const once = (await h.snapshot()).muted;

  await clickAt(h, PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "toggled");
  const twice = (await h.snapshot()).muted;

  assertEqual(
    once,
    !before,
    "muted after one press of the HUD's SOUND control (specs/screens.md)",
  );
  assertEqual(
    twice,
    before,
    "muted after a second press of the HUD's SOUND control (specs/screens.md)",
  );
});
