// Wick — progression/slot-order-is-acquisition-order: an item keeps the slot it
// entered for the rest of the run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "Slots":
// "An item enters the first free slot of its kind at level `1` and keeps that
// slot for the rest of the run, so slot order is acquisition order."
// "Choosing": a held weapon's "level rises by `1`", which says nothing about
// its slot. `specs/instrumentation.md`, `setNextOffers(ids)`: "Applies on a run
// screen and on `levelup`, where the next overlay is the queued one", and
// `choose(index)`: "the next queued overlay opens".
//
// THE POSE. An isolated `playing` run holding nothing, with five level-ups
// queued and each overlay's single offer fixed in turn, so five acceptances run
// back to back through the real path: Taper, then Ember, then Pin, each entering
// a slot as a new weapon, then Ember twice more, each a `+1 level`. The two
// levels on the middle slot are what a build that re-sorts its slots by level,
// by recency, or by id would reorder. A build that files a leveled item into a
// new slot reads more than three weapons.
//
// THE TOLERANCE. Exact: three ids in order, with their levels.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** What each of the five overlays offers, in order. */
const TAKEN: readonly OfferId[] = ["taper", "ember", "pin", "ember", "ember"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Taper, Ember, Pin in acquisition order while Ember levels twice", async () => {
  isolate(h);
  h.debug.setNextOffers([TAKEN[0]]);

  const first = await openLevelUp(h, TAKEN.length);
  assertDeepEqual(first.run.offers, [TAKEN[0]], "the first overlay's offers");

  for (let index = 0; index < TAKEN.length; index += 1) {
    assertDeepEqual(
      h.snapshot().run.offers,
      [TAKEN[index]],
      `the offers on overlay ${index + 1}`,
    );
    // Queue what the NEXT overlay presents before accepting this one, since
    // `choose` opens it at once while level-ups remain.
    if (index + 1 < TAKEN.length) h.debug.setNextOffers([TAKEN[index + 1]]);
    h.debug.choose(0);
  }
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "order");

  assertEqual(after.screen, "playing", "screen after the last acceptance");
  assertDeepEqual(
    after.run.weapons.map((weapon) => [weapon.id, weapon.level]),
    [
      ["taper", 1],
      ["ember", 3],
      ["pin", 1],
    ],
    "run.weapons after three acquisitions and two levels (specs/progression.md, Slots)",
  );
});
