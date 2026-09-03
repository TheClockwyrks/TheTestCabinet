// Wick — progression/pool-no-new-passive-when-full: with every passive slot
// filled, no unheld passive is a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": a passive not held enters the pool only "when a passive
// slot is free". "Slots": `PASSIVE_SLOTS` is `6`, and "An item enters the
// first free slot of its kind", so six held passives leave none free.
//
// THE POSE. An isolated `playing` run holding six passives, each at level `1`
// so every one of them is still a `+1 level` candidate and the pool is far
// from empty. The four passives left unheld are the ones the check reads for.
// Weapon slots are left free, so the pool also holds the ten base weapons and
// a build that empties the pool outright fails elsewhere rather than passing
// here.
//
// THE TOLERANCE. Exact: the absence of four ids from a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNotContains,
} from "../assert";
import { PASSIVE_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { FILLED_PASSIVES, UNHELD_PASSIVES, fillPassives } from "./loadout";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds no unheld passive in the pool with all six passive slots filled", async () => {
  isolate(h);
  fillPassives(h, {}, 1);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "full");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertLength(
    overlay.run.passives,
    PASSIVE_SLOTS,
    "passive slots filled (specs/progression.md, Slots)",
  );
  for (const id of FILLED_PASSIVES) {
    assertContains(
      overlay.run.pool,
      id,
      `run.pool holding the held passive ${id} at level 1`,
    );
  }
  for (const id of UNHELD_PASSIVES) {
    assertNotContains(
      overlay.run.pool,
      id,
      `run.pool with every passive slot filled (specs/progression.md, The candidate pool)`,
    );
  }
});
