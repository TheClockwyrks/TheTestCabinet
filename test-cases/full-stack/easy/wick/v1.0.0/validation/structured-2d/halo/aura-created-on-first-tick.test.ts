// halo/aura-created-on-first-tick — the aura is created on the first playing
// tick Halo is held, and stays one.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "Halo is a
// permanent aura: one zone of kind `aura` ... The zone is created on the
// first `playing` tick Halo is held and none exists". `specs/world.md` ("One
// tick"), phase 5, the placement: "an aura or a lantern set is created on a
// tick its weapon is held and none exists", which runs "on every `playing`
// tick, whatever the two hold" (`specs/instrumentation.md`, The driver
// switches). `specs/instrumentation.md` (`setWeapon`): "the aura of Halo or
// Corona ... appear on the next `playing` tick under the placement rule". So
// the tick after `setWeapon` places Halo holds exactly one aura, and because
// the aura is permanent and is created only when "none exists", the same
// zone, by id, is the one aura on every later tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing, Halo held
// at level 1, and every driver switch off: placement is gated by no switch,
// so the aura's creation is the only thing the ticks can do, and with
// `weaponFire` off no pulse is due, so the point reads the placement alone.
// No enemy is posed, since what the aura does to one is `pulses-first-tick`'s
// point.
//
// THE TOLERANCE. None: the count of auras is a whole number on fixed ticks,
// and the id is compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";
import { haloAuras } from "./aura";

/** Ticks run after the first, on which no second aura may appear. */
const LATER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds exactly one Halo aura after the first tick Halo is held, and the same one 30 ticks on", async () => {
  const posed = isolate(h);
  assertEqual(
    haloAuras(posed).length,
    0,
    "Halo auras in the isolated world before Halo is held",
  );
  holdWeapon(h, "halo", 1);

  const first = await advanceTicks(h, 1);
  captureStill(h, "created");
  const created = haloAuras(first);
  assertEqual(
    created.length,
    1,
    "zones of kind aura with weapon halo on the first playing tick Halo is held (specs/weapons.md, Halo)",
  );

  const later = await advanceTicks(h, LATER_TICKS);
  const kept = haloAuras(later);
  assertEqual(
    kept.length,
    1,
    `zones of kind aura with weapon halo ${LATER_TICKS} ticks later (specs/weapons.md, Halo)`,
  );
  assertEqual(
    kept[0].id,
    created[0].id,
    "the id of the one aura, the permanent zone the first tick created (specs/weapons.md, Halo)",
  );
});
