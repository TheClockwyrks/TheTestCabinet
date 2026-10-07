// Wick — progression/accept-level-rises: accepting a held item raises its level
// by one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: "A held weapon or passive ... Its level rises by
// `1`." "The candidate pool": a held base weapon below `MAX_WEAPON_LEVEL` is a
// candidate "as a `+1 level` offer".
//
// THE POSE. An isolated `playing` run holding Taper alone at level `3`, a
// middle level of the eight, with `setNextOffers(["taper"])` fixing the
// overlay's single offer to the held weapon, which the pool rule makes a
// candidate. One level-up is queued and the acceptance is read at once, before
// any tick runs. A build that resets the level, adds more than one, or files a
// second copy in another slot differs here.
//
// THE TOLERANCE. Exact: the whole `weapons` list, field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["taper"];
const LEVEL_BEFORE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes Taper from level 3 to level 4 in the slot it already held", async () => {
  isolate(h);
  holdWeapon(h, "taper", LEVEL_BEFORE);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");
  assertEqual(
    overlay.run.weapons[0].level,
    LEVEL_BEFORE,
    "Taper's level before the acceptance",
  );

  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "level");

  assertDeepEqual(
    after.run.weapons.map((weapon) => [weapon.id, weapon.level]),
    [["taper", LEVEL_BEFORE + 1]],
    "run.weapons after accepting the held Taper (specs/progression.md, Choosing)",
  );
});
