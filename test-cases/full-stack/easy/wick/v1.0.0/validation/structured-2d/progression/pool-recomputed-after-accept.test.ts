// Wick — progression/pool-recomputed-after-accept: the overlay a queued
// level-up opens draws from a pool computed from the slots the acceptance left.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing": "When level-ups remain queued the next overlay opens
// immediately, with a fresh pool drawn from the slots as the acceptance left
// them." "The candidate pool": "The pool is computed each time a level-up
// overlay opens, from the slots as they stand at that moment"; it holds "every
// held base weapon below `MAX_WEAPON_LEVEL`", and an unheld base weapon only
// "when a weapon slot is free". "The draw": "every candidate in a pool smaller
// than `OFFER_COUNT` is offered". "Slots": `WEAPON_SLOTS` and `PASSIVE_SLOTS`
// are `6`.
//
// THE POSE, and why it is the arrangement it is. Five base weapons are held at
// `MAX_WEAPON_LEVEL` and all six passive slots are filled at each passive's own
// max, so the FIRST pool is exactly the five base weapons that the one free
// weapon slot admits as new items. Two level-ups are queued, and
// `setNextOffers(["oil-splash"])` fixes the first overlay's single offer to one
// of those five, so accepting it fills the last free slot. What the acceptance
// leaves is a single candidate: `oil-splash`, now held at level `1` and below
// the maximum. The queued overlay therefore has to present exactly that one
// offer, since a pool smaller than `OFFER_COUNT` is offered whole.
//
// A build that keeps the pool it computed for the FIRST overlay draws three of
// the five weapons that slot admitted, so it presents three offers where one is
// required. The arrangement exhausts a slot for that reason: over free slots a
// stale pool and a fresh one hold the same ids, since a weapon just taken is a
// candidate either way, as a new item before and as a `+1 level` offer after.
//
// THE TOLERANCE. Exact: two lists of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  MAX_WEAPON_LEVEL,
  WEAPON_SLOTS,
  type BaseWeaponId,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { fillPassives } from "./loadout";

/** Five weapons at the maximum, so exactly one weapon slot stands free. */
const HELD: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "lantern",
  "halo",
];
/** The five the free slot admits: the first pool, in `BASE_WEAPON_IDS` order. */
const FIRST_POOL: OfferId[] = [
  "oil-splash",
  "spark",
  "shard",
  "sconce",
  "flare",
];
/** The one of them taken, which fills the last slot. */
const TAKEN: OfferId[] = ["oil-splash"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the queued overlay over the one candidate the acceptance left", async () => {
  isolate(h);
  for (const id of HELD) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  fillPassives(h);
  h.debug.setNextOffers(TAKEN);

  const first = await openLevelUp(h, 2);
  assertDeepEqual(
    first.run.pool,
    FIRST_POOL,
    "run.pool while one weapon slot stood free",
  );
  assertDeepEqual(first.run.offers, TAKEN, "the first overlay's offers");

  h.debug.choose(0);
  const second = h.snapshot();
  await h.frameDraw();
  captureStill(h, "fresh");

  assertEqual(second.screen, "levelup", "screen on the queued overlay");
  assertLength(
    second.run.weapons,
    WEAPON_SLOTS,
    "weapon slots filled by the acceptance",
  );
  assertDeepEqual(
    second.run.pool,
    TAKEN,
    "the fresh pool, holding the weapon just taken as its only candidate",
  );
  assertDeepEqual(
    second.run.offers,
    TAKEN,
    "the queued overlay's offers, drawn from the fresh pool (specs/progression.md, Choosing)",
  );
});
