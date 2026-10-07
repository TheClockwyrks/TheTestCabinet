// pointer/levelup-click-accepts — clicking an offer accepts that offer.
//
// WHAT THIS DECIDES. One thing: a primary press inside the rectangle of the
// overlay's second offer applies THAT offer and, with no further level-up
// queued, returns the game to `playing`. A click takes the item it lands in
// exactly as `confirm` on it does, so a build that accepted whatever the
// highlight already held adds the wrong weapon here.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`, playing
//   `menu-move` if that changed it, and then takes that item exactly as
//   `confirm` on it does."
//   specs/ui.md (`levelup`): "`confirm` accepts the highlighted offer ... Then,
//   if another level-up is queued, the next overlay opens with a fresh set of
//   offers and `menuIndex = 0`; else `screen = playing` and the simulation
//   resumes on the next tick."
//   specs/progression.md (Choosing): "A weapon or passive not held | It enters
//   the first free slot of its kind at level `1`. A weapon's cooldown timer
//   starts at `0`", and "Accepting decrements `pendingLevelUps`."
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The loadout after the click. The
// three offers are three different weapons and the run holds none of them, so
// which weapon the loadout gained names which offer the click took; the queue
// and the screen say the acceptance completed.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. An isolated `playing` run holding no
// weapon, three offers posed, and the overlay opened by the tick a queued
// level-up opens it. The highlight is asserted at `0` before the press, so the
// offer clicked is provably not the offer highlighted. "A frame whose press
// enters `playing` ... runs that frame's ticks" (specs/controls.md), so a whole
// frame would leave the accepted weapon a tick into its cooldown; a frame of
// half a tick delivers the same press and consumes none
// (specs/instrumentation.md).
//
// THE TOLERANCE. None: the accepted item, its level, its cooldown, the queue,
// and the screen are all exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { clickRectWithoutTick, menuRectAt } from "./pointing";

let h: Harness;

/** Three weapons no run holds after `isolate`, so the accepted one is named by id. */
const OFFERS = ["ember", "shard", "pin"] as const;
const ACCEPTED = 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the offer the click landed in and returns to playing", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );
  assertEqual(opened.menuIndex, 0, "the highlight before the click");
  assertDeepEqual(
    opened.run.weapons,
    [],
    "the loadout before the offer is accepted",
  );

  const rect = menuRectAt(h, ACCEPTED, "the second offer");
  const after = await clickRectWithoutTick(h, rect);
  captureStill(h, "accepted");

  assertEqual(after.screen, "playing", "the screen the click left the game on");
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups left queued after the acceptance",
  );
  assertDeepEqual(
    after.run.weapons,
    [{ id: OFFERS[ACCEPTED], level: 1, cooldown: 0 }],
    "the loadout the click left, holding the offer its rectangle belonged to",
  );
});
