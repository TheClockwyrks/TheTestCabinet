// Wick — halo/aura-created-on-first-tick: the aura is created on the first
// `playing` tick Halo is held, once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "Halo is a permanent aura: one zone of kind
//     `aura` ... The zone is created on the first `playing` tick Halo is held
//     and none exists, it is removed on the next `playing` tick Halo is no
//     longer held".
//   - `specs/world.md` ("One tick"), phase 5, the placement: "an aura or a
//     lantern set is created on a tick its weapon is held and none exists".
//   - `specs/instrumentation.md` (`setWeapon`): "Nothing else changes: the aura
//     of Halo or Corona ... appear on the next `playing` tick under the
//     placement rule", and ("The driver switches") "Placement is gated by
//     neither `weaponFire` nor `effectMotion`".
//   - `specs/state.md` (`ZoneState`): `ttl` is "`null` for a zone that never
//     expires: an aura", and `id` is "unique for the run, assigned from
//     `nextId`", which is what tells the aura created on the first tick from
//     one created again later.
//
// WHAT IS READ. The zones after the first `playing` tick Halo is held: exactly
// one of kind `aura` with weapon `halo`. Then the zones after each of the next
// 120 ticks: still exactly one such zone, and it is the same one, by id. The
// 120 ticks span two more pulses at level 1 (cooldown 1.00, 60 ticks), so a
// build that creates an aura on every pulse is caught by the count.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 1, nothing on the field,
// every switch off but `weaponFire`, which is on so the later ticks pulse: the
// pulse hits nothing on an empty field and creates no zone of its own, and no
// other weapon or entity can add a zone.
//
// TOLERANCE. None: a zone is in `zones` or it is not, and its id is a whole
// number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HALO_LEVELS, ticksFor } from "../constants";
import { captureStill, createHarness, enable, type Harness } from "../harness";
import { haloAuras, poseHalo, theAura } from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 1;

/** How many ticks after the first to keep reading: two level-1 cooldowns. */
const LATER_TICKS = 2 * ticksFor(HALO_LEVELS[LEVEL - 1].cooldown);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly one Halo aura on the first playing tick and no second one over 120 more", async () => {
  poseHalo(h, LEVEL, null);
  enable(h, "weaponFire");

  const first = await h.tick(1);
  captureStill(h, "created");

  const created = theAura(first, "after the first playing tick Halo is held");

  const later = await h.trace(LATER_TICKS);
  later.forEach((snapshot, index) => {
    const which = `tick ${index + 2}`;
    assertEqual(
      haloAuras(snapshot).length,
      1,
      `${which}: aura zones with weapon halo`,
    );
    assertEqual(
      haloAuras(snapshot)[0]?.id,
      created.id,
      `${which}: the aura's id, the one created on the first tick`,
    );
  });
});
