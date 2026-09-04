// screens/hud-sound-mutes — the HUD's `SOUND` control turns muting ON.
//
// THE RULE. specs/screens.md, the HUD's table: "`SOUND` | `HUD_ITEMS[2]` |
// Toggles muting, as specs/audio.md states." specs/audio.md: "Muting belongs to
// the engine ... The HUD's `SOUND` control toggles the engine's mute bit."
// specs/instrumentation.md reports the result as the snapshot's `muted`, "the
// game's copy of the runtime's mute bit, refreshed in every update", and gives
// the surface NO operation that sets it under this engine — so the control is the
// only way in and this reading is the only way out.
//
// ONE DIRECTION, WHICH IS WHY THERE ARE TWO ITEMS. A control that mutes and
// cannot unmute leaves a player no way back, and a control that never mutes
// leaves no way to quiet the game; those are different faults and they cost the
// player different things. `screens/hud-sound-unmutes` is the other half.
//
// THE GAME OPENS UNMUTED, which is the precondition that makes the reading mean
// anything: a build already muted would report `true` here for a reason that has
// nothing to do with the control. specs/audio.md leaves the engine's bus unmuted
// until something mutes it, and the pose below reads that rather than assuming
// it.
//
// THE REGION IS THE BUILD'S OWN. specs/controls.md leaves the HUD's layout to the
// build and specs/instrumentation.md has the build report it, so the press and
// the release are made at the middle of what `menuItemRect(HUD_SOUND_ITEM)`
// answered with, and both edges land inside it — which is the gesture that
// activates an item.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_SOUND_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuPoint,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("mutes the game on one press of SOUND", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is in live play, where the HUD's SOUND item answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );

  const press = menuPoint(h, HUD_SOUND_ITEM);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the mute bit before the press this point grades — a game already muted has nothing for this press to turn on",
  );

  clickAt(h, press.x, press.y);
  await h.advance(1);
  captureStill(h, "muted");

  assertEqual(
    h.snapshot().muted,
    true,
    "the mute bit the snapshot reports after one press and release inside the region " +
      "the build reports for its SOUND item (specs/screens.md, " +
      "specs/audio.md)",
  );
});
