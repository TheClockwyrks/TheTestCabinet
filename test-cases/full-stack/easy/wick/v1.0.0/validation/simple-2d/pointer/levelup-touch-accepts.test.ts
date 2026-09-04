// pointer/levelup-touch-accepts — a contact landing and lifting in an offer's
// rectangle accepts that offer.
//
// WHAT THIS DECIDES. One thing: a touch contact takes a level-up offer, so the
// one screen a run cannot get past without choosing answers a finger.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "a contact landing and
//   lifting inside the rectangle of the item at `menuIndex` `i` selects that
//   item and takes it exactly as `confirm` on it does."
//   specs/ui.md (`levelup`): `confirm` "accepts the highlighted offer".
//
// WHY IT IS A POINT OF ITS OWN. The overlay holds the run until an offer is
// taken, so a build that answers no contact there ends the night for a player on
// a touch device. The mouse's route is `pointer/levelup-click-accepts`'.
//
// THE DRIVE. An isolated night, a queued level-up whose offers are posed by
// `setNextOffers`, the tick that opens the overlay, and a contact landing at the
// middle of the SECOND offer's rectangle and lifting there. The second is chosen
// so a build that took the highlighted offer whatever the contact fell on is
// caught. Both frames are half a tick, so the run the acceptance handed back is
// read before any tick advanced it.
//
// THE TOLERANCE. None: a screen name, a queue count, and a loadout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { menuRectAt, touchTapRectWithoutTick } from "./pointing";

/** Three weapons no run holds after `isolate`, so the taken one is named by id. */
const OFFERS = ["ember", "shard", "pin"] as const;

/** The offer the contact takes: the second of the three. */
const TAPPED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the offer the contact took and returns to playing", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );

  const rect = menuRectAt(h, TAPPED, "the second offer");
  const after = await touchTapRectWithoutTick(h, rect);
  captureStill(h, "accepted");

  assertEqual(
    after.screen,
    "playing",
    "the screen the contact left the game on",
  );
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups left queued after the acceptance",
  );
  assertDeepEqual(
    after.run.weapons,
    [{ id: OFFERS[TAPPED], level: 1, cooldown: 0 }],
    "the loadout the contact left, holding the offer its rectangle belonged to",
  );
});
