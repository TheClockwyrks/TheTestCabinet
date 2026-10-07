// screens/hud-sound-unmutes — the HUD's `SOUND` control turns muting OFF again.
//
// `specs/screens.md`, the HUD's table: "`SOUND` | `HUD_ITEMS[2]` | Toggles
// muting, as `specs/audio.md` states." A toggle has two ends, and this is the one
// that gives the player the sound back; `screens/hud-sound-mutes` is the other.
//
// THE STARTING BIT IS POSED RATHER THAN CLICKED. `setMuted(true)` puts the game
// where this direction begins (`specs/instrumentation.md`, Muting), so the ONE
// press this point drives is the one it grades: routing through a first press
// would fail a build with a dead control twice for one defect, and this item
// would then say nothing that `screens/hud-sound-mutes` had not already said.
//
// THE REGION IS THE BUILD'S OWN, read back through `menuItemRect`, because
// `specs/controls.md` leaves the HUD's layout to the build.

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

it("unmutes the game on a press of SOUND made while muted", async () => {
  await openTable(h);

  await h.debug.setMuted(true);
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "posing: the mute bit before the press, which setMuted(true) put there " +
      "(specs/instrumentation.md) — a game that is not muted has nothing for " +
      "this press to turn off",
  );

  const press = await menuPoint(h, HUD_SOUND_ITEM);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unmuted");

  assertEqual(
    (await h.snapshot()).muted,
    false,
    "the mute bit after one press and release inside the region the build " +
      "reports for its SOUND item, made while the game was muted " +
      "(specs/screens.md)",
  );
});
