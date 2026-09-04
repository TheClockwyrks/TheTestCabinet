// contact/end-shows-no-chest-overlay — a tick that ends the run collects the
// chest it stands on, applies its result, and opens no chest overlay: screen
// fallen, not chest.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: "A tick that ends
// the run opens no overlay: a chest it collected has its result applied and no
// overlay shown, with chestResult left set so the end screen's run reports
// it". Phase 8 of One tick collects pickups and phase 11 ends the run, both
// before phase 12, where "A tick that ends the run opens no overlay."
//
// THE POSE. An isolated night keeping the fresh run's Taper at level 1 in the
// first weapon slot: hp posed to 0 through setHp, which "ends the run fallen at
// the end of the next playing tick", and one chest posed at the lamplighter's
// center, collected on the next tick by specs/world.md's collection rule. With
// Taper below MAX_WEAPON_LEVEL and no recipe passive held, the chest's result is
// the second rule of specs/evolutions.md, a level for the one held item, and
// hp stays at 0 for the ending to read; a heal result would raise hp above 0
// in phase 8 and no ending would follow, so the loadout is what keeps the tick
// an ending tick. weaponFire is off, so the held Taper fires nothing.
//
// THE TOLERANCE. None: the screen is discrete, and the chest's collection is
// read as the field holding no pickup.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** The hp posed: the fallen condition's boundary, met without a hit. */
const POSED_HP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run fallen over the chest it collected rather than opening the chest overlay", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "chest", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "ended");

  // The ending tick did collect the chest and apply a result.
  assertDeepEqual(after.run.pickups, [], "the chest was collected on the tick");
  assertNotNull(after.run.chestResult, "the chest's result was applied");
  assertEqual(after.screen, "fallen", "screen after the ending tick");
});
