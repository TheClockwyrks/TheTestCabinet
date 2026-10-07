// Wick — halo/aura-created-on-first-tick: the aura is created on the first
// `playing` tick Halo is held, and only one ever exists.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "Halo is a
// permanent aura: one zone of kind `aura` ... The zone is created on the first
// `playing` tick Halo is held and none exists". `specs/world.md` (phase 5,
// "The placement, on every `playing` tick") has "an aura ... created on a tick
// its weapon is held and none exists", and `specs/instrumentation.md`
// (`setWeapon`) says "the aura of Halo ... appear[s] on the next `playing`
// tick under the placement rule", with "Placement ... gated by neither
// `weaponFire` nor `effectMotion`". So the tick after `setWeapon` places Halo
// leaves exactly one zone of kind `aura` with `weapon` `halo`, created on that
// tick, and every later tick leaves that same one and no other.
//
// THE POSE. An isolated night with Halo held at level 1 and nothing else:
// every faculty is held, `weaponFire` included, because the requirement is the
// placement's creation rather than a pulse, and there is nothing to pulse on.
// One tick is stepped and the zones it created are read as the entries whose
// id is at least the `nextId` the tick started from; then `LATER_TICKS` more
// are stepped and the auras are read again.
//
// TOLERANCE. None: the counts and the id are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  newZones,
  type Harness,
} from "../harness";
import { HALO, aurasOf } from "./stage";

/** The level Halo is held at; the row is another point's business. */
const LEVEL = 1;

/** Ticks stepped after the creation tick, on which no second aura may appear. */
const LATER_TICKS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates exactly one aura zone of weapon halo on the first tick Halo is held, and no second one later", async () => {
  await isolate(h);
  await holdWeapon(h, HALO, LEVEL);
  const before = await h.snapshot();
  assertEqual(aurasOf(before).length, 0, "auras before the first tick");

  const created = await h.step(1);
  await captureStill(h, "created");

  const auras = aurasOf(created);
  assertEqual(auras.length, 1, "auras after the first tick Halo is held");
  const aura = auras[0]!;
  assertEqual(aura.weapon, HALO, "the aura's weapon");
  assertDeepEqual(
    newZones(before, created).map((zone) => zone.id),
    [aura.id],
    "the zones the first tick created",
  );

  const later = await h.step(LATER_TICKS);
  assertDeepEqual(
    aurasOf(later).map((zone) => zone.id),
    [aura.id],
    `the auras after ${LATER_TICKS} more ticks`,
  );
});
