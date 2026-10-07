// Wick — screens/levelup-confirm-accepts: `confirm` accepts the offer the
// highlight is on, not the first one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "`confirm` accepts the highlighted offer, as `specs/progression.md` states.
// Then, if another level-up is queued, the next overlay opens ...; else
// `screen = playing`". `specs/progression.md`, "Choosing": "the item at
// `menuIndex` is highlighted ... `confirm` accepts the highlighted offer", a
// passive not held "enters the first free slot of its kind at level `1`", and
// "Accepting decrements `pendingLevelUps`." `specs/controls.md` binds
// `confirm` to `Enter` and `Space`.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off, with three offers queued BY NAME through `setNextOffers` — a weapon
// first, a passive second, a passive third, all candidates of the pool over an
// empty loadout, presented "exactly that list in that order"
// (`specs/instrumentation.md`). One level-up is posed pending, the tick opens
// the overlay, one real `ArrowDown` moves the highlight to the second offer,
// and one real `Enter` accepts it.
//
// WHAT IS READ. The second offer applied and the first NOT: a build that
// accepted whatever sits at index `0` holds Ember instead of Tallow and fails.
// With the queue empty, `screen` reads `playing`.
//
// THE TOLERANCE. None: a slot's contents, a level, a count, and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

/** The offers the overlay presents, in order; the second is the one accepted. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "lure"];
/** The index the highlight is moved to. */
const ACCEPTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the second offer and returns to playing", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(
    overlay.run.offers,
    OFFERS,
    "the offers the overlay presents",
  );
  assertEqual(
    overlay.run.pendingLevelUps,
    1,
    "the level-ups pending before the press",
  );

  const posed = await tap(h, "ArrowDown");
  assertEqual(
    posed.menuIndex,
    ACCEPTED,
    "the highlighted offer before the press",
  );

  const after = await tap(h, "Enter");
  captureStill(h, "accepted");

  assertEqual(after.screen, "playing", "the screen after the queue emptied");
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups pending after accepting",
  );
  assertLength(after.run.passives, 1, "the passives held after accepting");
  assertEqual(
    after.run.passives[0].id,
    OFFERS[ACCEPTED],
    "the item the acceptance applied",
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
