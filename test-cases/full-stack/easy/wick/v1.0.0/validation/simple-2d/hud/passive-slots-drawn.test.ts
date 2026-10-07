// hud/passive-slots-drawn — the held passives fill the passive slots in slot
// order and the rest stay empty.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Passive slots | `PASSIVE_SLOTS` (`6`) slots, the same way", after "Weapon
// slots | `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its
// icon with one pip per level held, and an empty slot visibly empty."
// specs/assets.md ("The icons") fixes the picture each slot carries: "Each is
// one `24 x 24` sprite at `assets/icons/<id>.png`", one for "each id in
// `BASE_WEAPON_IDS`, `EVOLUTION_IDS`, and `PASSIVE_IDS`". So with Brass and
// Lure held in slots 0 and 1, the frame owes `icons/brass.png` and
// `icons/lure.png` in that order, and the four slots after them owe no icon.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing on the ground,
// NO WEAPON held, every driver switch off, with the two passives placed in
// order through `setPassive` into the first two free slots. The fresh run's
// Taper is what `isolate` removes, and with no weapon held every icon the frame
// blits is a passive slot's, so the reading needs no notion of where on the
// frame the two rows of slots sit.
//
// WHAT IS READ. Every blit of a produced file under `assets/icons/`, one entry
// per place an icon was drawn, ordered as the slots read: down the frame, each
// row of slots left to right. The list must be exactly the two held passives in
// slot order, which decides both halves of the requirement at once: the order
// the two carry, and that no third slot carries anything, a repeat of a held
// icon included.
//
// TOLERANCE. None: an icon is a produced file the frame either blitted or did
// not, and the order is a comparison of two lists.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { type PassiveId } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { iconsInSlotOrder } from "./hud";

/** The two passives held, in the slot order they are placed in. */
const HELD: readonly PassiveId[] = ["brass", "lure"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws Brass and Lure in slot order and no third icon", async () => {
  isolate(h);
  for (const id of HELD) holdPassive(h, id, 1);
  const posed = h.snapshot();
  assertLength(
    posed.run.weapons,
    0,
    "weapons held, so every icon is a passive",
  );
  assertDeepEqual(
    posed.run.passives.map((held) => held.id),
    [...HELD],
    "the passives held, in slot order",
  );

  const { blits } = await h.frameDraw();
  captureStill(h, "slots");

  assertDeepEqual(
    iconsInSlotOrder(h, blits),
    [...HELD],
    "the produced icons the frame drew, in slot order",
  );
});
