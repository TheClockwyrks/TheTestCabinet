// progression/offers-whole-small-pool — a pool smaller than OFFER_COUNT is
// offered whole, and nothing is invented to fill the list out.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The draw: "The overlay offers
// OFFER_COUNT distinct candidates drawn uniformly at random from the pool
// without replacement ... and every candidate in a pool smaller than
// OFFER_COUNT is offered", with OFFER_COUNT (3). The lamp-oil fallback belongs
// to the empty pool alone: "When the pool is empty the overlay offers exactly
// one item, LAMP_OIL_ID", and a pool of two is not empty.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, posed to a pool of exactly two. Every weapon slot holds a base weapon
// and every passive slot a passive, so neither new-item rule can add anything
// (specs/progression.md, The candidate pool). Five of the six weapons stand at
// MAX_WEAPON_LEVEL (8) and five of the six passives at their PASSIVES max, so
// none of those ten is a +1 candidate; Sconce at 7 and Bellows at 4 are each
// one below their max and are the two that remain. None of the six weapons
// carries an aura or a lantern set, so the placement part of phase 5 of
// specs/world.md creates nothing. The overlay is opened the real way, by
// queueing a level-up and running the playing tick that ends with it queued.
//
// THE TOLERANCE. None on the count or the ids. The two are read as a set,
// since the spec fixes which candidates a short pool offers and not the order
// they are listed in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import {
  MAX_WEAPON_LEVEL,
  OFFER_COUNT,
  PASSIVES,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The weapon left one level below MAX_WEAPON_LEVEL: one of the two candidates. */
const CANDIDATE_WEAPON: BaseWeaponId = "sconce";

/** The passive left one level below its max: the other candidate. */
const CANDIDATE_PASSIVE: PassiveId = "bellows";

/** Six base weapons filling every weapon slot; none carries an aura or lanterns. */
const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  CANDIDATE_WEAPON,
];

/** Six passives filling every passive slot. */
const FULL_PASSIVES: readonly PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  CANDIDATE_PASSIVE,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("presents both candidates of a two-deep pool and nothing else", async () => {
  isolate(h);
  for (const id of FULL_WEAPONS) {
    holdWeapon(
      h,
      id,
      id === CANDIDATE_WEAPON ? MAX_WEAPON_LEVEL - 1 : MAX_WEAPON_LEVEL,
    );
  }
  for (const id of FULL_PASSIVES) {
    const max = PASSIVES[id].maxLevel;
    holdPassive(h, id, id === CANDIDATE_PASSIVE ? max - 1 : max);
  }

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "small");

  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offers are read from",
  );
  assertDeepEqual(
    [...overlay.run.pool].sort(),
    [CANDIDATE_PASSIVE, CANDIDATE_WEAPON].sort(),
    "the two candidates the slots leave",
  );
  assertLessThan(overlay.run.pool.length, OFFER_COUNT, "a pool short of three");
  assertDeepEqual(
    [...overlay.run.offers].sort(),
    [CANDIDATE_PASSIVE, CANDIDATE_WEAPON].sort(),
    "the offers over a two-deep pool",
  );
});
