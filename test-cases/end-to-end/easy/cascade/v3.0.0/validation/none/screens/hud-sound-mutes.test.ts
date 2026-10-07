// screens/hud-sound-mutes — the HUD's `SOUND` control turns muting ON.
//
// `specs/screens.md`, the HUD's table: "`SOUND` | `HUD_ITEMS[2]` | Toggles
// muting, as `specs/audio.md` states." `specs/instrumentation.md` fixes where the
// answer is read: `muted`, "the game's copy of the runtime's mute bit, refreshed
// in every update".
//
// ONE DIRECTION, WHICH IS WHY THERE ARE TWO ITEMS. A control that mutes and
// cannot unmute leaves a player no way back, and a control that never mutes
// leaves no way to quiet the game; those are different faults and they cost the
// player different things. `screens/hud-sound-unmutes` is the other half.
//
// THE STARTING BIT IS POSED RATHER THAN ASSUMED. `specs/instrumentation.md` has
// `reset` leave `muted` "exactly as it stands, because muting is a player
// preference the runtime owns", so a fresh page could report either value and a
// check that assumed one would grade the build's opening preference. `setMuted`
// puts the bit where this direction needs it, and the click is then the only
// thing that can move it.
//
// THE REGION IS THE BUILD'S OWN. `specs/controls.md` leaves the HUD's layout to
// the build, so the press and the release are made at the middle of what
// `menuItemRect(HUD_SOUND_ITEM)` answered with, and both edges land inside it —
// which is the gesture that activates an item.

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

/** One frame, so the canvas carries the HUD the assertion read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("mutes the game on one press of SOUND", async () => {
  await openTable(h);

  await h.debug.setMuted(false);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "posing: the mute bit before the press, which setMuted(false) put there " +
      "(specs/instrumentation.md) — a game already muted has nothing for this " +
      "press to turn on",
  );

  const press = await menuPoint(h, HUD_SOUND_ITEM);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "muted");

  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the mute bit after one press and release inside the region the build " +
      "reports for its SOUND item (specs/screens.md)",
  );
});
