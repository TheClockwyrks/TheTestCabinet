// Wick — evolutions/chandelier-removed-when-dropped: the set is removed on the
// next `playing` tick Chandelier is no longer held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "The
// set is removed on the next `playing` tick Chandelier is no longer held."
// `specs/world.md` (phase 5, "The placement, on every `playing` tick"): "an aura
// or a lantern set is created on a tick its weapon is held and removed on a tick
// its weapon is no longer held", and `specs/instrumentation.md` (`removeWeapon`)
// says the same from the surface's side: "Its aura or lantern set is removed on
// the next `playing` tick under the placement rule." So after `removeWeapon` on
// Chandelier's slot, the next tick's snapshot holds no zone of kind `lantern`.
//
// THE POSE. An isolated night with every driver switch off, Chandelier held and
// one tick to place the set, `removeWeapon` on its slot, and one more tick.
// Placement is "gated by neither `weaponFire` nor `effectMotion`", so both ticks
// run the rule with nothing else running beside it. Every zone of the kind is
// read rather than only Chandelier's own, so a build that left the lanterns
// behind under another weapon's name is read as lanterns still standing.
//
// TOLERANCE. None: the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  zonesOfKind,
} from "../harness";
import { placeChandelierSet } from "./stage";

/** Chandelier's fixed amount, `4`. */
const AMOUNT = weaponRow("chandelier").amount as number;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds no lantern zone on the tick after Chandelier's slot is emptied", async () => {
  await isolate(h);
  const set = await placeChandelierSet(h);
  assertEqual(
    set.lanterns.length,
    AMOUNT,
    "Chandelier lantern zones the placing tick created",
  );

  await h.debug.removeWeapon(set.slot);
  const dropped = await h.step(1);
  await captureStill(h, "removed");

  assertDeepEqual(
    zonesOfKind(dropped, "lantern").map((zone) => ({
      id: zone.id,
      weapon: zone.weapon,
    })),
    [],
    "lantern zones on the tick after Chandelier was dropped",
  );
});
