// evolutions/chandelier-removed-when-dropped — Chandelier's set is removed
// when it is no longer held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "The
// set is removed on the next `playing` tick Chandelier is no longer held."
// `specs/world.md` ("One tick"), phase 5: "an aura or a lantern set is created
// on a tick its weapon is held and none exists, and removed on a tick its
// weapon is no longer held". `specs/instrumentation.md` (`removeWeapon`):
// "Removes the weapon in `slot` ... Its aura or lantern set is removed on the
// next `playing` tick under the placement rule." So the tick after
// `removeWeapon` leaves no lantern zone in the world at all.
//
// WHY EVERY LANTERN ZONE IS COUNTED, NOT ONLY CHANDELIER'S. The requirement is
// that the set is gone, and a build that left the zones behind under another
// weapon's name would still be showing lanterns; the run holds no other weapon
// that could have placed one, so a lantern zone of any weapon on that tick is
// the set that should have been removed.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Chandelier, every driver switch off, so the placing tick and the removing
// tick each do one thing. The set is read as standing before the removal, so a
// build that never placed it fails on that line rather than on an emptiness it
// reached by doing nothing.
//
// THE TOLERANCE. None: a count of zones on a fixed tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHANDELIER_STATS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  zonesOfKind,
  type Harness,
} from "../harness";
import { placeChandelier } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no lantern zone on the tick after Chandelier is removed from its slot", async () => {
  const placed = await placeChandelier(h);
  assertEqual(
    placed.lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns standing before the removal (specs/evolutions.md, Chandelier)",
  );

  h.debug.removeWeapon(placed.slot);
  assertEqual(
    h.snapshot().run.weapons.length,
    0,
    "the weapons held after the removal (specs/instrumentation.md, removeWeapon)",
  );

  const after = await advanceTicks(h, 1);
  captureStill(h, "removed");

  assertEqual(
    zonesOfKind(after, "lantern").length,
    0,
    "the lantern zones standing on the next playing tick after Chandelier was dropped (specs/evolutions.md, Chandelier)",
  );
});
