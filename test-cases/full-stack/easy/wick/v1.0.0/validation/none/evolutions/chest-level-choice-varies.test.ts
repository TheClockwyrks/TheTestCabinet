// Wick — evolutions/chest-level-choice-varies: the item a chest levels is drawn
// at random, so it is not the same one every chest.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 2: "One held item below its max level ... is chosen uniformly at
// random". Over `CHESTS` (`40`) chests opened over the same two candidates a
// uniform draw lands on each of them: a build that always levels the same item
// has not drawn at all, and a fair draw misses one of two over forty chests
// once in `2^39`.
//
// THE POSE. Forty chests on one isolated night, each opened over Taper at
// level 3 and Brass at level 1, the pair of `chest-fallback-level`, both below
// their max and nothing eligible to evolve. The loadout is posed back to those
// levels before each chest through `setWeapon` and `setPassive`, which leave a
// changed level's slot standing, and the overlay each chest opens is left
// through `setScreen("playing")`, which "Sets `screen` to `name` ... Nothing
// else changes". Each chest is reached the real way through the harness's
// `openChest`, and nothing is posed for the draw itself.
//
// TOLERANCE. None on the reading: both ids must appear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { chestOutcome, closeChest } from "./stage";

/** How many chests are opened, as the review item states. */
const CHESTS = 40;

/** Taper's posed level: below `MAX_WEAPON_LEVEL`, so nothing is eligible to evolve. */
const TAPER_LEVEL = 3;

/** Brass's posed level: below its max of `3`. */
const BRASS_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("levels Taper on some of forty chests and Brass on others", async () => {
  await isolate(h);
  const chosen: string[] = [];
  for (let chest = 1; chest <= CHESTS; chest += 1) {
    await holdWeapon(h, "taper", TAPER_LEVEL, 0);
    await holdPassive(h, "brass", BRASS_LEVEL, 0);
    const opened = await openChest(h);
    const result = chestOutcome(opened, `chest ${chest}`);
    assertEqual(result.kind, "level", `the result's kind of chest ${chest}`);
    if (result.kind === "level") chosen.push(result.item);
    await closeChest(h, opened);
  }
  await captureStill(h, "random");

  assertEqual(chosen.length, CHESTS, "chests opened");
  assertTrue(
    chosen.includes("taper"),
    `Taper leveled by at least one of the ${CHESTS} chests (got ${chosen.join(", ")})`,
  );
  assertTrue(
    chosen.includes("brass"),
    `Brass leveled by at least one of the ${CHESTS} chests (got ${chosen.join(", ")})`,
  );
});
