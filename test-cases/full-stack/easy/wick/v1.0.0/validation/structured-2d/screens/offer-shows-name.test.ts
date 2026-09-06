// Wick — screens/offer-shows-name: each offer is listed under its item's own
// display name.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`", the
// offer table: the Name part is "The weapon's name from `WEAPON_NAMES`, the
// passive's from `PASSIVES`, or `LAMP_OIL_NAME` (`Lamp Oil`)."
// `specs/progression.md`, "The draw": "When the pool is empty the overlay
// offers exactly one item, `LAMP_OIL_ID`", so the third of those names needs
// an overlay with nothing left to offer.
//
// THE DRIVE. Two overlays, because two loadouts are needed to reach all three
// kinds of name. First an isolated `playing` run holding nothing, with a
// weapon and a passive queued by name through `setNextOffers` — both are
// candidates of the pool over an empty loadout, and
// `specs/instrumentation.md` says "the overlay then presents exactly that list
// in that order". Then an isolated run with every weapon slot at
// `MAX_WEAPON_LEVEL` and every passive slot at its own max, whose pool is
// empty, so the overlay draws the lamp-oil offer. Every driver switch is off
// in both, so the loadout the pool is computed from is the one that was posed.
//
// THE TOLERANCE. Each name is exact, as a substring of a run of drawn text, so
// a build that draws a marker or a tag beside it reads the same.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  LAMP_OIL_ID,
  LAMP_OIL_NAME,
  PASSIVES,
  WEAPON_NAMES,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { fillEverySlot } from "./stage";

/** A weapon and a passive, both candidates of the pool over an empty loadout. */
const OFFERS: readonly OfferId[] = ["ember", "tallow"];

/** The names those two are listed under. */
const NAMES: readonly string[] = [WEAPON_NAMES.ember, PASSIVES.tallow.name];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a weapon's, a passive's, and lamp oil's display name", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(
    overlay.run.offers,
    OFFERS,
    "the offers the overlay presents",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "names");
  for (const name of NAMES) {
    assertTrue(
      drewText(calls, name),
      `the overlay drew the offer's name ${JSON.stringify(name)} (specs/ui.md, levelup)`,
    );
  }

  isolate(h);
  fillEverySlot(h);
  const oil = await openLevelUp(h, 1);
  assertLength(
    oil.run.pool,
    0,
    "the candidate pool with every slot filled and maxed",
  );
  assertDeepEqual(
    oil.run.offers,
    [LAMP_OIL_ID],
    "the offers over an empty pool",
  );

  const second = await h.frameDraw();
  assertEqual(oil.screen, "levelup", "the screen the second frame is read on");
  assertTrue(
    drewText(second.calls, LAMP_OIL_NAME),
    `the overlay drew ${JSON.stringify(LAMP_OIL_NAME)} for the lamp-oil offer (specs/ui.md, levelup)`,
  );
});
