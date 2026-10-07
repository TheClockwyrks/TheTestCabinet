// progression/pool-recomputed-after-accept — a queued second overlay draws from
// a fresh pool.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"): "When
// level-ups remain queued THE NEXT OVERLAY OPENS IMMEDIATELY, WITH A FRESH POOL
// DRAWN FROM THE SLOTS AS THE ACCEPTANCE LEFT THEM." "The candidate pool" gives
// what that pool is: "computed each time a level-up overlay opens, from the
// slots as they stand", holding "every held base weapon below
// `MAX_WEAPON_LEVEL`" and, "when a weapon slot is free, every base weapon not
// held". "Slots" fixes `WEAPON_SLOTS` at `6`. So an acceptance that fills the
// last free weapon slot leaves a second pool that holds the accepted weapon as a
// `+1` candidate and holds no base weapon that is not held, where the first pool
// held all four of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, with five weapons held at level `1` so exactly one weapon
// slot is free: that is the one arrangement in which a single acceptance changes
// which ids the rule admits, and it is therefore the only arrangement in which a
// stale pool and a fresh one differ at all. The queue is posed at `2` so the
// second overlay opens on the acceptance itself, and the offer is fixed with
// `setNextOffers` so the acceptance is of the weapon that closes the last slot
// rather than of a draw. Both pools are read, so the check is that the four
// unheld weapons LEFT the pool rather than that they were never in it.
//
// THE TOLERANCE. None: an id is in a pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import { WEAPON_SLOTS, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { FULL_WEAPONS, SPARE_WEAPONS } from "./stage";

/** The five weapons held before the acceptance, leaving one slot free. */
const HELD = FULL_WEAPONS.slice(0, WEAPON_SLOTS - 1);

/** The weapon accepted: the sixth, which closes the last free weapon slot. */
const ACCEPTED = FULL_WEAPONS[WEAPON_SLOTS - 1]!;

/** The offer the first overlay is made to present. */
const OFFERED: OfferId[] = [ACCEPTED];

/** The level-ups queued: two, so the second overlay opens on the acceptance. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("recomputes the second pool from the slots the acceptance left", async () => {
  await isolate(h);
  for (const id of HELD) await holdWeapon(h, id, 1);
  await h.debug.setNextOffers(OFFERED);

  const first = await openLevelUp(h, QUEUED);
  assertEqual(
    first.screen,
    "levelup",
    "the screen the queued level-ups opened",
  );
  assertDeepEqual(
    first.run.offers,
    OFFERED,
    "the offers the first overlay presents",
  );
  assertDeepEqual(
    SPARE_WEAPONS.filter((id) => !first.run.pool.includes(id)),
    [],
    "the unheld base weapons the first pool left out with a slot free",
  );

  await h.debug.choose(0);
  const second = await h.snapshot();
  await captureStill(h, "fresh");

  assertEqual(second.screen, "levelup", "the screen the acceptance left");
  assertEqual(
    second.run.pendingLevelUps,
    QUEUED - 1,
    "the queue the acceptance left",
  );
  assertEqual(
    second.run.weapons.length,
    WEAPON_SLOTS,
    "the weapon slots the acceptance filled",
  );
  assertContains(
    second.run.pool,
    ACCEPTED,
    "the second pool, for the accepted weapon as a held candidate",
  );
  assertDeepEqual(
    SPARE_WEAPONS.filter((id) => second.run.pool.includes(id)),
    [],
    "the unheld base weapons the second pool offered with every slot filled",
  );
});
