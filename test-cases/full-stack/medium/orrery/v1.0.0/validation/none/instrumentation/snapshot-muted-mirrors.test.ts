// instrumentation/snapshot-muted-mirrors — `muted` is the runtime's mute bit as
// it stands, not a figure of the game's own.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape: "Three fields need the
// game to keep them honest every frame: ... `muted` mirrors the runtime's mute
// bit", declared as "muted: <boolean>". `specs/ui.md` says which way the wiring
// runs: the game "binds the `mute` action to the runtime's mute bit and toggles it
// from any screen, then mirrors that bit into `state.muted` every frame".
// `specs/controls.md` binds the action: "`mute` | `KeyM` | Toggles sound, from any
// screen." And `specs/instrumentation.md` keeps the surface out of it: of `reset`,
// "`muted` is untouched; the runtime owns muting."
//
// THE CONFIGURATION. A reset session on the title screen, which
// `specs/controls.md` lists as one of the screens that reads `mute`. Nothing else
// is posed: the bit belongs to the runtime, so the check reads whatever it stands
// at, presses the bound key, and reads it again.
//
// WHERE THE BIT STANDS TO BEGIN WITH IS FIXED TOO. "Sound is on when the game
// starts: the mute bit is off on the first frame, so `state.muted` reports
// `false` until the `mute` action is first pressed, and that first press mutes"
// (`specs/ui.md`, Audio). So the opening reading is a value and not a
// don't-care, and the two presses after it are read as the flips the toggle
// makes: on, then off again.
//
// THE VERDICT. The snapshot opens reporting `false`; the value flips to `true` on
// the frame the `mute` press is delivered and stands there across a frame; and a
// second press flips it back — so what it reports is the runtime's bit as the
// action moves it rather than a constant.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips with the mute action and reports the bit as it stands", async () => {
  await openTitle(h);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "sound is on when the game starts: the mute bit is off on the first frame",
  );

  await pressAction(h, "mute");
  await captureStill(h, "toggled");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the first press mutes, and muted reports the runtime's bit flipped",
  );

  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the flipped bit stands across a frame, because muted mirrors it rather than pulsing",
  );

  await pressAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "a second press toggles it back, so what is reported is the bit rather than a constant",
  );
});
