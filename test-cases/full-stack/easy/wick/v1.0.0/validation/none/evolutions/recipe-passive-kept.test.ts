// Wick — evolutions/recipe-passive-kept: the recipe passive stays held after
// the evolution.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 1: "The evolved weapon replaces its base in the same slot with a single
// level, its cooldown timer is set to `0` ..., the passive stays held, and the
// `evolve` cue plays." `specs/progression.md` ("Slots"): "An item enters the
// first free slot of its kind at level `1` and keeps that slot for the rest of
// the run." So with Wick posed at level 3 in passive slot `0`, the chest that
// evolves Taper into Pyre leaves Wick in slot `0` at level `3`.
//
// WHY LEVEL 3. A level above `1` separates a build that keeps the passive from
// one that re-adds it at level `1` after consuming it; Wick's max level is `5`
// (`specs/passives.md`), so `3` is a legal posed level.
//
// THE POSE. An isolated night with Taper at level 8 and Wick at level 3, and
// the chest reached the real way through the harness's `openChest`. Nothing
// else runs on the tick.
//
// TOLERANCE. None: the passive list, the slot, the id, and the level are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { chestOutcome } from "./stage";

/** The level Wick is posed at: above `1`, so a re-added passive reads differently. */
const WICK_LEVEL = 3;

/** The passive slot Wick is posed in. */
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves Wick in its passive slot at level 3 after Taper evolves", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, 0);
  await holdPassive(h, "wick", WICK_LEVEL, SLOT);

  const opened = await openChest(h);
  await captureStill(h, "kept");

  const result = chestOutcome(opened, "the chest with Taper 8 and Wick 3");
  assertEqual(result.kind, "evolve", "the chest result's kind");
  const passives = opened.run.passives ?? [];
  assertEqual(passives.length, 1, "passive slots held after the evolution");
  assertEqual(
    passives[0]?.id,
    "wick",
    "the passive in slot 0 after the evolution",
  );
  assertEqual(
    passives[0]?.level,
    WICK_LEVEL,
    "Wick's level after the evolution",
  );
});
