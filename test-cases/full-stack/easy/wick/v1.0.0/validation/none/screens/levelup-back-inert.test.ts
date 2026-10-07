// screens/levelup-back-inert — `back` does nothing on the level-up overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`back` and
// `pause` do nothing here." specs/controls.md ("What each screen reads"), the
// `levelup` row, names `up`, `down`, `confirm` and `mute` alone, and "An action
// a row omits does nothing on that screen." specs/instrumentation.md
// (`setScreen`) says the same of the way out: on `levelup`, "`choose` is the
// way out."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with three offers queued
// and the highlight moved off `0` with one `ArrowDown` before the press,
// because "does nothing" has to be told from "reopens the overlay": a build
// that sent `back` through the same path as an arrival would leave `menuIndex`
// `0` and pass against an overlay that was already there. The offers are read
// back after the press as well, since a build that redrew the list would have
// changed them. The press is a REAL `Escape` held across exactly one frame.
//
// THE TOLERANCE. None: a screen name, an index, and a list of offer ids are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressBack,
  pressDown,
  type Harness,
} from "../harness";
import { assertHighlight, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "pin", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the overlay, its offers and its highlight where Escape found them", async () => {
  await night(h);
  await openOffers(h, OFFERS);
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressBack(h);
  await captureStill(h, "inert");

  assertHighlight(after, "levelup", 1, "after Escape on the overlay");
  assertEqual(
    (after.run.offers ?? []).join(","),
    OFFERS.join(","),
    "the offers the overlay lists after Escape",
  );
  assertEqual(
    after.run.pendingLevelUps,
    1,
    "the level-ups queued after Escape",
  );
});
