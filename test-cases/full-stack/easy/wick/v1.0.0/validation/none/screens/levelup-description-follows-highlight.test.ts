// screens/levelup-description-follows-highlight — moving the highlight changes
// the line the overlay draws.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "Beneath the offer
// list the overlay draws one more line: the description of the offer at
// `menuIndex`, on one line. A weapon's is its line in `WEAPON_DESCRIPTIONS`, a
// passive's is its line in `PASSIVE_DESCRIPTIONS`", and "`up` and `down` move
// the highlight and wrap at both ends". specs/controls.md ("What each screen
// reads"), the `levelup` row: "`up`, `down` move the highlight, wrapping", read
// as press edges. So the line the overlay draws after the press is the one the
// offer at the new `menuIndex` carries, and the one it drew before is gone.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout and
// three offers queued through `setNextOffers`, the first a weapon and the
// second a passive, so the press moves the line from one of the two records
// specs/ui.md names to the other. The line drawn before the press is read
// first, so a build that draws nothing at all fails on the precondition rather
// than on the move. The press is a REAL `ArrowDown` through Chromium's input
// pipeline held across exactly one frame, and the overlay ticks nothing, so the
// only thing that differs between the two frames is what the highlight drew.
//
// THE TOLERANCE. The copy is matched ignoring case and whitespace, across the
// runs of text the frame drew joined in reading order (the shared harness's
// `drewTextAnywhere`) — and the two lines stay distinct under that reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { descriptionOf } from "../constants";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { assertHides, assertShows, night, openOffers, shown } from "./stage";

/** Three candidates of an empty loadout's pool, a weapon then a passive. */
const OFFERS = ["ember", "wick", "pin"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the second offer's line in place of the first's on ArrowDown", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(opened.menuIndex, 0, "the highlighted offer before the press");
  const before = await shown(h);
  assertShows(
    before,
    descriptionOf(OFFERS[0]),
    "the overlay's line before the press",
  );

  const moved = await pressDown(h);
  assertEqual(moved.menuIndex, 1, "the highlighted offer after ArrowDown");
  const after = await shown(h);
  await captureStill(h, "followed");

  assertShows(
    after,
    descriptionOf(OFFERS[1]),
    "the overlay's line for the offer the highlight moved to",
  );
  assertHides(
    after,
    descriptionOf(OFFERS[0]),
    "the overlay's line for the offer the highlight left",
  );
});
