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
// WHY THE READING IS A FLIP RATHER THAN A VALUE. No sentence of `specs/` fixes
// which way the runtime's bit starts, so a check that demanded `false` first would
// be asserting the reference rather than the specification. What the rule fixes is
// that the action TOGGLES and that the snapshot reports the bit as it stands, so
// the reading is that the press changed it and a second press changed it back.
//
// THE VERDICT. The value the snapshot reports flips on the frame the `mute` press
// is delivered, and flips back on the next one — so what it reports is a bit the
// action moves rather than a constant.

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
  const before = (await h.snapshot()).muted;
  assertEqual(typeof before, "boolean", "muted is a boolean");

  await pressAction(h, "mute");
  await captureStill(h, "toggled");
  assertEqual(
    (await h.snapshot()).muted,
    !before,
    "the mute action toggles the runtime's bit, and muted reports it flipped",
  );

  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    !before,
    "the flipped bit stands across a frame, because muted mirrors it rather than pulsing",
  );

  await pressAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    before,
    "a second press toggles it back, so what is reported is the bit rather than a constant",
  );
});
