// controls/key-downgrade — `KeyG` harvests the selected candidate one tier lower.
//
// THE REQUIREMENT. `specs/controls.md` binds `downgrade` to `KeyG`: "Harvests the
// selected candidate one quality tier lower." `specs/scrap-press.md` fixes what
// that produces — "the selected candidate becomes a permanent component at one
// quality tier lower than it rolled" — and that it is offered on a candidate at
// Tuned or above.
//
// HOW IT IS DECIDED. One candidate is dropped through the real press with its
// roll armed to a Charged (tier `3`) component, well above the Tuned floor the
// action needs, and selected. `KeyG` is pressed as a player presses it, a real
// browser key event through the build's own keyboard layer, and the structure
// left standing on those tiles is read: the same type, one tier down, permanent.
//
// WHAT THIS POINT IS NOT. That the action is refused on a Scrap candidate is the
// press checklist's own point; this one decides the key in the direction it works.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  structureAt,
  type Harness,
} from "../harness";

/** Where the candidate is dropped: clear of the chain and of the yard edges. */
const ANCHOR = { col: 10, row: 0 };

/** Charged: two tiers above Scrap, so a downgrade has somewhere to land. */
const TYPE = "capacitor";
const TIER = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("harvests one quality tier lower when KeyG is pressed", async () => {
  await openYard(h);
  const id = await standCandidate(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  await h.tap(keyFor("downgrade"));
  await captureStill(h, "downgraded");

  const after = await h.snapshot();
  const kept = structureAt(after, ANCHOR.col, ANCHOR.row);
  assertTruthy(
    kept,
    `a structure still standing at (${ANCHOR.col}, ${ANCHOR.row}) after the ` +
      "downgrade key (specs/scrap-press.md)",
  );
  assertEqual(
    kept!.kind,
    "component",
    `pressing ${keyFor("downgrade")} to turn the selected candidate into a ` +
      "permanent component (specs/controls.md, specs/scrap-press.md)",
  );
  assertEqual(
    kept!.type,
    TYPE,
    "the harvested component's type, which a downgrade leaves alone " +
      "(specs/scrap-press.md)",
  );
  assertEqual(
    kept!.quality,
    TIER - 1,
    `a candidate that rolled at quality ${TIER} harvested one tier lower ` +
      "(specs/controls.md, specs/scrap-press.md)",
  );
});
