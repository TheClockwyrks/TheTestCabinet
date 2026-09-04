// screens/levelup-confirm-accepts — confirm accepts the highlighted offer.
//
// WHAT THIS DECIDES. One thing: `confirm` on the overlay applies the offer the
// highlight rests on, not the first one and not another, and, with no further
// level-up queued, returns the game to `playing`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "`confirm` accepts the highlighted offer, as
//   `specs/progression.md` states. Then, if another level-up is queued, the
//   next overlay opens with a fresh set of offers and `menuIndex = 0`; else
//   `screen = playing` and the simulation resumes on the next tick."
//   specs/progression.md ("Choosing"): "A weapon or passive not held | It
//   enters the first free slot of its kind at level `1`. A weapon's cooldown
//   timer starts at `0`", and "Accepting decrements `pendingLevelUps`."
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order", so the offer at index `1` is known.
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE. An isolated `playing` run holding no weapon, so the accepted
// weapon lands in the first slot and the loadout read afterwards holds it
// alone; three ids posed, the overlay opened by the tick a queued level-up
// opens it, and one `ArrowDown` to put the highlight on the SECOND offer, which
// is the state this point names and which the surface poses no other way. Then
// one `Enter`. The three offers are three different weapons, so a build that
// accepted the wrong row is caught by which weapon it added.
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
  tap,
  type Harness,
} from "../harness";

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

it("applies the offer under the highlight and returns to playing", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );
  assertEqual(
    opened.run.pendingLevelUps,
    1,
    "the level-ups queued while the overlay is open",
  );
  assertDeepEqual(
    opened.run.weapons,
    [],
    "the loadout before the offer is accepted",
  );

  const staged = await tap(h, "ArrowDown");
  assertEqual(staged.menuIndex, ACCEPTED, "the highlight Enter is pressed on");

  const after = await tap(h, "Enter");
  captureStill(h, "accepted");

  assertEqual(after.screen, "playing", "the screen Enter left the game on");
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups left queued after the acceptance",
  );
  assertDeepEqual(
    after.run.weapons,
    [{ id: OFFERS[ACCEPTED], level: 1, cooldown: 0 }],
    "the loadout the accepted offer left, holding the highlighted offer alone",
  );
});
