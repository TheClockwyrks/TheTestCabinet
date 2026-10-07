// Wick — progression/pool-new-weapons-with-free-slot: every base weapon not
// held is a candidate while a weapon slot is free.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": "when a weapon slot is free, every base weapon not held
// whose evolution is not held, each as a new item", and "The base weapons are
// the ten in `BASE_WEAPON_IDS`". "Slots" gives `WEAPON_SLOTS` (`6`).
//
// THE POSE. An isolated `playing` run holding Taper alone at level `1`, which
// leaves five weapon slots free and no evolution held, so the rule admits
// every one of the other nine base weapons. Every driver switch is off and the
// world is empty. The overlay is opened by the real path, one queued level-up
// and one `playing` tick.
//
// THE TOLERANCE. Exact: membership of nine ids in a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLessThan } from "../assert";
import { BASE_WEAPON_IDS, WEAPON_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The nine base weapons the pose leaves unheld. */
const UNHELD = BASE_WEAPON_IDS.filter((id) => id !== "taper");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the other nine base weapons in the pool with Taper alone held", async () => {
  isolate(h);
  holdWeapon(h, "taper", 1);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "new");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertLessThan(
    overlay.run.weapons.length,
    WEAPON_SLOTS,
    "weapon slots filled, so one is free (specs/progression.md, Slots)",
  );
  for (const id of UNHELD) {
    assertContains(
      overlay.run.pool,
      id,
      `run.pool holding the unheld base weapon ${id} (specs/progression.md, The candidate pool)`,
    );
  }
});
