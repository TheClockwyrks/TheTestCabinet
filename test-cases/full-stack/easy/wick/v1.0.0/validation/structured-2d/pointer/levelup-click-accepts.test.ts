// Wick — pointer/levelup-click-accepts: clicking an offer accepts that offer.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i` ... and then takes that item exactly
// as `confirm` on it does." `specs/ui.md`, "`levelup`": "`confirm` accepts the
// highlighted offer, as `specs/progression.md` states. Then, if another
// level-up is queued, the next overlay opens ...; else `screen = playing`."
// `specs/progression.md`, "Choosing": a passive not held "enters the first free
// slot of its kind at level `1`", and "Accepting decrements
// `pendingLevelUps`."
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The second offer applied and the
// first NOT: a build whose click accepts whatever the highlight already sat on
// holds Ember instead of Tallow and fails. With the queue empty, `screen` reads
// `playing`.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off, with three offers queued BY NAME through `setNextOffers` — a weapon
// first, a passive second, a passive third, all candidates of the pool over an
// empty loadout, presented "exactly that list in that order"
// (`specs/instrumentation.md`). One level-up is posed pending, the tick opens
// the overlay, and a primary press and release land in the middle of the second
// offer's own rectangle before the frame that reads the edge. The overlay opens
// on `menuIndex` `0`, so the click both moves the highlight and takes what it
// landed in.
//
// THE TOLERANCE. None: a slot's contents, a level, a count, and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  isolate,
  menuRects,
  openLevelUp,
  type Harness,
} from "../harness";

/** The offers the overlay presents, in order; the second is the one clicked. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "lure"];
/** The index of the second offer. */
const ACCEPTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the second offer and returns to playing when a click takes it", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the click is made on");
  assertDeepEqual(overlay.run.offers, OFFERS, "the offers the overlay shows");
  assertEqual(overlay.menuIndex, 0, "the highlighted offer before the click");
  assertEqual(
    overlay.run.pendingLevelUps,
    1,
    "the level-ups pending before the click",
  );

  const rects = menuRects(h);
  assertLength(
    rects,
    OFFERS.length,
    "the overlay's rectangles, one per offer (specs/controls.md, The pointer)",
  );

  const after = await clickRect(h, rects[ACCEPTED]);
  captureStill(h, "accepted");

  assertEqual(
    after.screen,
    "playing",
    "the screen after the queue emptied (specs/ui.md, levelup)",
  );
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups pending after the click accepted one",
  );
  assertLength(after.run.passives, 1, "the passives held after the click");
  assertEqual(
    after.run.passives[0].id,
    OFFERS[ACCEPTED],
    "the item the click applied (specs/controls.md, Click)",
  );
  assertEqual(
    after.run.passives[0].level,
    1,
    "the level a new passive enters at",
  );
  assertLength(
    after.run.weapons,
    0,
    "the weapons held, the first offer untaken",
  );
});
