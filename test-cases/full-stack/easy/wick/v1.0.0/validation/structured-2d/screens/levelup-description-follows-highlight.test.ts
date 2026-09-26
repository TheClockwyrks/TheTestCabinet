// Wick — screens/levelup-description-follows-highlight: moving the highlight
// puts the newly highlighted offer's line in place of the one before it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "Beneath the offer list the overlay draws one more line: the description of
// the offer at `menuIndex`, on one line", and "`menuIndex` is `0` on opening.
// `up` and `down` move the highlight and wrap at both ends".
// `specs/controls.md` binds `down` to `ArrowDown` and `KeyS`. One line, of the
// offer at `menuIndex`, so the frame after the move draws the second offer's
// line and no longer draws the first's.
//
// WHAT IS READ, AND WHY. The strings two frames drew: the frame the overlay
// opened on, and the frame after one `ArrowDown`. Each is read for both lines,
// so a build that draws every offer's line at once fails as surely as one
// whose line never changes. A run of text is matched as a SUBSTRING, so
// padding around the line reads the same, and the two lines share no words in
// common. That the line is drawn beneath the list at all is
// `screens/levelup-shows-description`'s point.
//
// THE DRIVE. An isolated `playing` run holding nothing, with a weapon and two
// passives queued by name through `setNextOffers` — all three are candidates
// of the pool over an empty loadout, and `specs/instrumentation.md` says "the
// overlay then presents exactly that list in that order" — and the one
// `playing` tick that opens the overlay. Every driver switch is off, so
// nothing but the press moves the highlight. Then one real `ArrowDown`.
//
// THE TOLERANCE. None: each line is exact, ignoring case and surrounding
// characters, and each frame is read for its presence and the other's absence.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
} from "../assert";
import {
  PASSIVE_DESCRIPTIONS,
  WEAPON_DESCRIPTIONS,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

/** Three candidates of the pool over an empty loadout, in the order offered. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "lure"];

/** The line each of the first two carries (specs/ui.md, Descriptions). */
const FIRST_LINE = WEAPON_DESCRIPTIONS.ember;
const SECOND_LINE = PASSIVE_DESCRIPTIONS.tallow;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the second offer's line in place of the first's after ArrowDown", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the press is made on");
  assertDeepEqual(
    overlay.run.offers,
    OFFERS,
    "the offers the overlay presents",
  );
  assertEqual(overlay.menuIndex, 0, "the highlighted offer on opening");

  const opened = await h.frameDraw();
  assertTrue(
    drewText(opened.calls, FIRST_LINE),
    `the overlay drew ${JSON.stringify(FIRST_LINE)} for the offer at menuIndex 0 (specs/ui.md, levelup)`,
  );
  assertFalse(
    drewText(opened.calls, SECOND_LINE),
    `the overlay drew ${JSON.stringify(SECOND_LINE)} while the offer at menuIndex 0 was highlighted (specs/ui.md, levelup)`,
  );

  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "the highlighted offer after ArrowDown");

  const after = await h.frameDraw();
  captureStill(h, "followed");
  assertTrue(
    drewText(after.calls, SECOND_LINE),
    `the overlay drew ${JSON.stringify(SECOND_LINE)} for the offer at menuIndex 1 (specs/ui.md, levelup)`,
  );
  assertFalse(
    drewText(after.calls, FIRST_LINE),
    `the overlay drew ${JSON.stringify(FIRST_LINE)} after the highlight left the offer at menuIndex 0 (specs/ui.md, levelup)`,
  );
});
