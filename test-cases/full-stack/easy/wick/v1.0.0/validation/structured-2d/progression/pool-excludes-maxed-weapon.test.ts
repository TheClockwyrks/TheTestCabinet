// Wick — progression/pool-excludes-maxed-weapon: a base weapon at
// `MAX_WEAPON_LEVEL` is not a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": the pool holds "every held base weapon BELOW
// `MAX_WEAPON_LEVEL`", and "Slots": "A base weapon levels up to
// `MAX_WEAPON_LEVEL`" (`8`). A weapon standing at that level therefore has no
// `+1 level` offer, and its slot is filled, so it is not a new item either.
//
// THE POSE. An isolated `playing` run holding Taper at level `8` and nothing
// else. Weapon slots are still free, so the pool is otherwise full of new
// weapons and passives and the check reads a real pool rather than an empty
// one. Every driver switch is off and the world is empty. The overlay is
// opened by the real path, one queued level-up and one `playing` tick.
//
// THE TOLERANCE. Exact: the absence of one id from a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotContains } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves taper out of the pool while it stands at MAX_WEAPON_LEVEL", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "maxed");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertEqual(
    overlay.run.weapons[0].level,
    MAX_WEAPON_LEVEL,
    "the level Taper stands at",
  );
  assertNotContains(
    overlay.run.pool,
    "taper",
    `run.pool with Taper held at ${MAX_WEAPON_LEVEL} (specs/progression.md, The candidate pool)`,
  );
});
