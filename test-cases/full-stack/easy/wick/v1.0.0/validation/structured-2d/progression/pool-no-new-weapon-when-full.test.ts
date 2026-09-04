// Wick — progression/pool-no-new-weapon-when-full: with every weapon slot
// filled, no unheld base weapon is a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": a base weapon not held enters the pool only "when a weapon
// slot is free". "Slots": `WEAPON_SLOTS` is `6`, and "An item enters the first
// free slot of its kind", so six held weapons leave none free.
//
// THE POSE. An isolated `playing` run holding six base weapons, each at level
// `1` so every one of them is still a `+1 level` candidate and the pool is far
// from empty. The four base weapons left unheld are the ones the check reads
// for: with the slots full, none of them may appear. Passive slots are left
// free, so the pool also holds the ten passives and a build that empties the
// pool outright fails elsewhere rather than passing here.
//
// THE TOLERANCE. Exact: the absence of four ids from a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNotContains,
} from "../assert";
import { WEAPON_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { FILLED_WEAPONS, UNHELD_WEAPONS, fillWeapons } from "./loadout";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds no unheld base weapon in the pool with all six weapon slots filled", async () => {
  isolate(h);
  fillWeapons(h, {}, 1);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "full");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertLength(
    overlay.run.weapons,
    WEAPON_SLOTS,
    "weapon slots filled (specs/progression.md, Slots)",
  );
  for (const id of FILLED_WEAPONS) {
    assertContains(
      overlay.run.pool,
      id,
      `run.pool holding the held weapon ${id} at level 1`,
    );
  }
  for (const id of UNHELD_WEAPONS) {
    assertNotContains(
      overlay.run.pool,
      id,
      `run.pool with every weapon slot filled (specs/progression.md, The candidate pool)`,
    );
  }
});
