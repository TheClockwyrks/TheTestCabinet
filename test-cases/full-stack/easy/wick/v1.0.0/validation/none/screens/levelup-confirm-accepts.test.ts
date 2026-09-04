// screens/levelup-confirm-accepts — `confirm` accepts the highlighted offer and
// gives play back.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`confirm` accepts
// the highlighted offer, as `specs/progression.md` states. Then, if another
// level-up is queued, the next overlay opens with a fresh set of offers and
// `menuIndex = 0`; else `screen = playing` and the simulation resumes on the
// next tick." specs/progression.md ("Choosing"), the acceptance table: "A
// weapon or passive not held | It enters the first free slot of its kind at
// level `1`", and "Accepting decrements `pendingLevelUps`."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an EMPTY loadout and
// exactly one level-up queued, so the acceptance has a free slot to fill and
// nothing else queued to open a second overlay. Three offers are queued through
// `setNextOffers`, and the highlight is moved to the second with one
// `ArrowDown`, read back before the confirm: the offer accepted must be the
// HIGHLIGHTED one rather than the first, so the two are made different. Both
// presses are REAL keys held across exactly one frame.
//
// THE TOLERANCE. None: a screen name, a slot's id and level, and a count of
// queued level-ups are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressConfirm,
  pressDown,
  weaponIn,
  type Harness,
} from "../harness";
import { night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool; the second is the one accepted. */
const OFFERS = ["ember", "pin", "wick"] as const;

/** The offer the highlight is moved to. */
const CHOSEN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the second offer and returns to playing when Enter accepts it", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(
    opened.run.pendingLevelUps,
    1,
    "the level-ups queued when the overlay opened",
  );
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    CHOSEN,
    "the highlighted offer before the confirm",
  );

  const accepted = await pressConfirm(h);
  await captureStill(h, "accepted");

  assertEqual(accepted.screen, "playing", "the screen the accepted offer left");
  assertEqual(
    accepted.run.pendingLevelUps,
    0,
    "the level-ups queued after the acceptance",
  );
  assertEqual(
    weaponIn(accepted, OFFERS[CHOSEN])?.level,
    1,
    `the level of ${OFFERS[CHOSEN]}, the highlighted offer, after the acceptance`,
  );
  assertEqual(
    weaponIn(accepted, OFFERS[0]),
    undefined,
    `${OFFERS[0]}, the offer that was not highlighted, held after the acceptance`,
  );
});
