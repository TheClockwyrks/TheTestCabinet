// hud/weapon-slots-drawn — the weapon slots carry the held weapons' icons, in
// slot order, and carry nothing where no weapon is held.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Weapon slots |
// `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its icon with
// one pip per level held, and an empty slot visibly empty." The pips are
// `hud/level-pips`; this point is about the icons and the order.
//
// THE LOADOUT, AND WHY IT IS THREE OF SIX. `specs/progression.md`: "An item
// enters the first free slot of its kind at level `1` and keeps that slot for
// the rest of the run, so slot order is acquisition order." So Taper, Ember and
// Pin taken in that order sit in slots `0`, `1` and `2`, and slots `3` to `5`
// are empty — a loadout that decides the icons, their order, and the three
// empty slots at once.
//
// HOW A SLOT IS READ. `specs/assets.md` produces one icon file per weapon and
// `specs/ui.md` has the slot draw it, so the icons are found by the PRODUCED
// FILE each blit's bytes came from, never by a colour or a coordinate: the
// build's palette, layout, and slot chrome are its own.
//
// WHAT "VISIBLY EMPTY" IS READ AS. `specs/ui.md` fixes no styling, so what a
// build draws for an empty slot — an outline, a well, nothing at all — is the
// build's and cannot be asserted. What the spec sentence does decide is that no
// weapon's icon is in a slot no weapon is in, so the three empty slots are read
// as: the frame drew no weapon icon but the three held.
//
// THE ORDER. The three icons are laid out in slot order along whichever axis the
// build ranged the slots on, increasing in the direction a player reads
// (`hud/slots.ts`). A build that draws the three in acquisition order passes
// whether it ranges its slots across or down; one that draws them in some other
// order does not.

import { afterEach, beforeEach, it } from "vitest";
import {
  BASE_WEAPON_IDS,
  EVOLUTION_IDS,
  WEAPON_SLOTS,
  type WeaponId,
} from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { iconAt, iconsDrawn, inOrder } from "./slots";

/** The weapons held, in the order they are taken, which is slot order. */
const HELD: readonly WeaponId[] = ["taper", "ember", "pin"];

/** Every weapon whose icon `specs/assets.md` produces. */
const EVERY_WEAPON: readonly WeaponId[] = [
  ...BASE_WEAPON_IDS,
  ...EVOLUTION_IDS,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the held weapons' icons in slot order and no others", async () => {
  isolate(h);
  HELD.forEach((id, slot) => {
    assertEqual(holdWeapon(h, id), slot, `the slot ${id} took`);
  });

  const blits = await h.frameBlits();
  captureStill(h, "slots");

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertDeepEqual(
    posed.run.weapons.map((weapon) => weapon.id),
    [...HELD],
    "the weapons the run holds, in slot order",
  );
  assertTrue(
    HELD.length < WEAPON_SLOTS,
    `a loadout leaving some of the ${WEAPON_SLOTS} weapon slots empty`,
  );

  assertDeepEqual(
    iconsDrawn(blits, EVERY_WEAPON),
    EVERY_WEAPON.filter((id) => HELD.includes(id)),
    "the weapon icons the frame drew",
  );

  const places = HELD.map((id) => {
    const at = iconAt(blits, id);
    assertNotNull(at, `where the frame drew ${id}'s icon`);
    return at as { x: number; y: number };
  });
  assertTrue(inOrder(places), "the held weapons' icons laid out in slot order");
});
