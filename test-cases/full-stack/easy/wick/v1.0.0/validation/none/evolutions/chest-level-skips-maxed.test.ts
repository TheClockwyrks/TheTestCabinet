// Wick — evolutions/chest-level-skips-maxed: a chest's level result passes over
// an item already at its max.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level, a base weapon below
// `MAX_WEAPON_LEVEL` or a passive below its own max, is chosen ... and rises by
// `1`". With Taper at `MAX_WEAPON_LEVEL` (`8`) and no Wick held, rule 1 finds
// nothing to evolve — "the passive its recipe names is held" fails — and Taper
// is not a candidate for rule 2 either, since it is not below its max. Brass at
// level `1` is below its max of `3` (`specs/passives.md`), so it is the only
// candidate and a uniform draw over one candidate is that candidate: the result
// is `{ kind: "level", item: "brass", level: 2 }` and Taper still reads `8`.
//
// THE POSE. An isolated night with Taper at level 8 and Brass at level 1, no
// Wick, and the chest reached the real way through the harness's `openChest`.
//
// TOLERANCE. None: the result's three fields and the two levels are exact.

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
  passiveIn,
  weaponIn,
  type Harness,
} from "../harness";
import { chestOutcome } from "./stage";

/** Brass's posed level: below its max of `3`, and the only candidate. */
const BRASS_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("levels Brass to 2 and leaves the maxed Taper at 8", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, 0);
  await holdPassive(h, "brass", BRASS_LEVEL, 0);

  const opened = await openChest(h);
  await captureStill(h, "skipped");

  const result = chestOutcome(opened, "the chest with Taper 8 and Brass 1");
  assertEqual(result.kind, "level", "the chest result's kind");
  if (result.kind === "level") {
    assertEqual(result.item, "brass", "the item the chest leveled");
    assertEqual(result.level, BRASS_LEVEL + 1, "the level Brass became");
  }
  assertEqual(
    passiveIn(opened, "brass")?.level,
    BRASS_LEVEL + 1,
    "Brass's level after the chest",
  );
  assertEqual(
    weaponIn(opened, "taper")?.level,
    MAX_WEAPON_LEVEL,
    "Taper's level after the chest",
  );
});
