// Wick — evolutions/first-eligible-in-slot-order: one chest evolves the first
// eligible weapon in slot order and leaves the rest.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 1: "The held weapons are checked in slot order, first slot first, and
// the first base weapon at `MAX_WEAPON_LEVEL` whose recipe passive is held at
// any level evolves. ... One chest evolves at most one weapon." The recipe
// table gives Beacon as Ember's evolution with Oil as its passive, and Pyre as
// Taper's with Wick. So with Ember at `8` in slot `0`, Taper at `8` in slot `1`,
// and both Oil and Wick held, the chest evolves Ember alone: slot `0` reads
// `beacon` at level `1`, slot `1` still reads `taper` at level `8`, and the
// result is `{ kind: "evolve", weapon: "beacon" }`.
//
// WHY THE ORDER IS THE READING. `BASE_WEAPON_IDS` lists Taper before Ember
// (`specs/weapons.md`), so a build checking the recipe table or the id list
// rather than the slots evolves Taper here, and the two slots separate the two
// readings. `specs/progression.md` ("Slots") fixes what a slot is: "An item
// enters the first free slot of its kind ... so slot order is acquisition
// order", and `setWeapon(slot, id, level)` puts a weapon in the slot named.
//
// THE POSE. An isolated night, Ember at level 8 in slot 0 and Taper at level 8
// in slot 1 through `setWeapon`, Oil and Wick each at level 1 through
// `setPassive`, and the chest reached the real way through the harness's
// `openChest`.
//
// TOLERANCE. None: the two slots' ids and levels and the result are exact.

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
import { chestOutcome, slotOf } from "./stage";

/** The slot Ember is posed in: the first checked. */
const FIRST = 0;

/** The slot Taper is posed in: eligible too, and reached second. */
const SECOND = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("evolves the Ember in slot 0 into Beacon and leaves the Taper in slot 1 at level 8", async () => {
  await isolate(h);
  await holdWeapon(h, "ember", MAX_WEAPON_LEVEL, FIRST);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, SECOND);
  await holdPassive(h, "oil", 1);
  await holdPassive(h, "wick", 1);

  const opened = await openChest(h);
  await captureStill(h, "first");

  const first = slotOf(opened, FIRST, "after the chest");
  assertEqual(first.id, "beacon", "the weapon in slot 0 after the chest");
  assertEqual(first.level, 1, "Beacon's level after the chest");
  const second = slotOf(opened, SECOND, "after the chest");
  assertEqual(second.id, "taper", "the weapon in slot 1 after the chest");
  assertEqual(second.level, MAX_WEAPON_LEVEL, "Taper's level after the chest");
  const result = chestOutcome(opened, "the chest with two eligible weapons");
  assertEqual(result.kind, "evolve", "the chest result's kind");
  assertEqual(
    result.kind === "evolve" ? result.weapon : undefined,
    "beacon",
    "the chest result's weapon",
  );
});
