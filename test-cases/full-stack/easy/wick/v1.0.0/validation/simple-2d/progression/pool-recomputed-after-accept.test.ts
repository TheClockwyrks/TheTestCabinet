// progression/pool-recomputed-after-accept — the overlay that opens on a queued
// level-up draws from a pool computed from the slots the acceptance left, not
// from the pool the previous overlay drew from.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "When level-ups
// remain queued the next overlay opens immediately, with a fresh pool drawn
// from the slots as the acceptance left them." The candidate pool: the new
// weapons are offered "when a weapon slot is free", so filling the last free
// weapon slot is exactly what a recomputed pool notices and a kept one does
// not. specs/instrumentation.md, setScreen's levelup row, describes the same
// opening: "the pool is computed, nextOffers is consumed or the draw is made,
// and offers is filled".
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, five base weapons held at level 1 so exactly one weapon slot is free,
// and two level-ups queued. None of the six weapons this scenario holds carries
// an aura or a lantern set, so the placement part of phase 5 of specs/world.md
// creates nothing.
//
// Lantern is a new-item candidate of the first pool, since a weapon slot is
// free and Lantern is not held. Flare is put in front of the first overlay
// through setNextOffers and accepted, which fills the last weapon slot; the
// second pool, computed from those slots, therefore holds no base weapon that
// is not held, Lantern among them. Lantern is queued for the second overlay
// through setNextOffers before the acceptance, where a list "is accepted when
// every id is a candidate of the pool at that moment ... Otherwise it is
// discarded whole and the overlay draws at random" (specs/instrumentation.md).
// A build that drew the second overlay from the first pool presents Lantern; a
// build that recomputed cannot offer it at all.
//
// THE TOLERANCE. None: an id is in the pool and among the offers, or it is not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertNotContains,
} from "../assert";
import { WEAPON_SLOTS, type BaseWeaponId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Five base weapons at level 1: one weapon slot left free. */
const HELD: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
];

/** The new weapon accepted, which fills the last free weapon slot. */
const ACCEPTED: BaseWeaponId = "flare";

/** A new-item candidate of the first pool that the acceptance rules out. */
const RULED_OUT: BaseWeaponId = "lantern";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the second overlay at once over a pool the acceptance emptied of new weapons", async () => {
  isolate(h);
  for (const id of HELD) holdWeapon(h, id, 1);
  h.debug.setNextOffers([ACCEPTED]);

  const first = await openLevelUp(h, 2);
  assertEqual(first.screen, "levelup", "the first overlay");
  assertDeepEqual(first.run.offers, [ACCEPTED], "the offer put in front of it");
  assertContains(first.run.pool, RULED_OUT, "Lantern in the first pool");

  // Queued for the overlay the acceptance opens: "on levelup, where the next
  // overlay is the queued one" (specs/instrumentation.md, setNextOffers).
  h.debug.setNextOffers([RULED_OUT]);
  h.debug.choose(0);
  const second = h.snapshot();
  await h.frameDraw();
  captureStill(h, "fresh");

  assertEqual(second.screen, "levelup", "the second overlay, opened at once");
  assertEqual(second.run.tick, first.run.tick, "no tick between the two");
  assertEqual(second.run.weapons.length, WEAPON_SLOTS, "the slots now full");
  assertNotContains(
    second.run.pool,
    RULED_OUT,
    "Lantern out of the second pool",
  );
  assertNotContains(
    second.run.offers,
    RULED_OUT,
    "Lantern out of the second overlay's offers",
  );
});
