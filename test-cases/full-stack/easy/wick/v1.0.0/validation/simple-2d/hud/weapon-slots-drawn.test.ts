// hud/weapon-slots-drawn — the held weapons fill the weapon slots in slot order
// and the rest stay empty.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Weapon slots | `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as
// its icon with one pip per level held, and an empty slot visibly empty."
// specs/assets.md ("The icons") fixes the picture each slot carries: "Each is
// one `24 x 24` sprite at `assets/icons/<id>.png`", and "The HUD's slots and
// the level-up and chest overlays draw them". So with Taper, Ember, and Pin
// held in slots 0, 1, and 2, the frame owes `icons/taper.png`,
// `icons/ember.png`, and `icons/pin.png` in that order, and the three slots
// after them owe no icon at all.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing on the ground,
// no passive held, every driver switch off, with the three weapons placed in
// order through `setWeapon` into the first three free slots. `weaponFire` is
// off, so nothing fires and no effect is drawn over the night while the frame
// is read. No passive is held, so every icon the frame blits is a weapon slot's.
//
// WHAT IS READ. Every blit of a produced file under `assets/icons/`, one entry
// per place an icon was drawn, ordered as the slots read: down the frame, each
// row of slots left to right. specs/ui.md fixes no arrangement for the slots,
// so a row and a grid read the same way, and the reading is of WHICH icons were
// drawn, WHERE, and in WHAT ORDER rather than of the shape a build gave a slot.
// The list must be exactly the three held weapons in slot order, which decides
// both halves of the requirement at once: the order the three carry, and that
// no fourth slot carries anything, a repeat of a held icon included.
//
// TOLERANCE. None: an icon is a produced file the frame either blitted or did
// not, and the order is a comparison of two lists.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { type WeaponId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { iconsInSlotOrder } from "./hud";

/** The three weapons held, in the slot order they are placed in. */
const HELD: readonly WeaponId[] = ["taper", "ember", "pin"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws Taper, Ember, and Pin in slot order and no fourth icon", async () => {
  isolate(h);
  for (const id of HELD) holdWeapon(h, id, 1);
  assertDeepEqual(
    h.snapshot().run.weapons.map((held) => held.id),
    [...HELD],
    "the weapons held, in slot order",
  );

  const { blits } = await h.frameDraw();
  captureStill(h, "slots");

  assertDeepEqual(
    iconsInSlotOrder(h, blits),
    [...HELD],
    "the produced icons the frame drew, in slot order",
  );
});
